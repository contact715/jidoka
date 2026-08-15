#!/usr/bin/env node
// @closes-class: core-property-substituted-by-scaffold
/**
 * guardrail-tripwire — a PreToolUse tripwire that halts a run the MOMENT the core property is
 * being substituted by scaffolding, instead of discovering it at the end.
 *
 * THE CLASS IT CLOSES (`core-property-substituted-by-scaffold`, named by the owner 2026-07-04):
 * a wave is asked for something with a load-bearing quality — "the environment must be
 * non-deterministic", "it must answer in any words", "real data, not a mock" — and what gets built
 * is the frame: regex triggers instead of a model decision, a fixture instead of live data, a fixed
 * list instead of generation. Every gate downstream passes, because the frame is genuinely correct.
 * Only the adjective is missing, and the adjective was the whole request.
 *
 * WHAT IS NEW HERE, and what deliberately is NOT. The DETECTION already exists:
 * `replan-ledger.coreSubstitutionSignals()` compares a demanded dynamic quality against the
 * evidence text. It is called from exactly one place — `replan()` — which runs when the controller
 * stops to think. Between two such moments an agent can write twenty files. This hook reuses that
 * same detector (no second implementation, no second bar) and moves it to per-action time.
 *
 * WHERE THE CORE PROPERTY COMES FROM: the `coreProperty:` spec field added in 2026-W33-R6. Before
 * that field existed this hook would have had nothing to check against, which is why the two were
 * proposed in the same engine and why this one is built after it.
 *
 * Safety, same contract as policy-enforce-hook:
 *   - Fail-open: no spec, no core property, unreadable input → exit 0. A tripwire that guesses is
 *     worse than none, because it teaches people to disable it.
 *   - Only Write/Edit-shaped actions carrying CONTENT are examined; a path alone proves nothing.
 *   - Blocks with exit 2 and names the demanded quality against the scaffold word that triggered.
 *
 * Self-test: node hooks/guardrail-tripwire.mjs --self-test
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** The content an action is about to write, from whichever field the tool uses. Pure. */
export function actionContent(input = {}) {
  if (!input || typeof input !== 'object') return '';
  const parts = [input.content, input.new_string, input.new_str, input.text, input.body]
    .filter((v) => typeof v === 'string');
  return parts.join('\n');
}

/**
 * Find the core property governing this run. Pure over an injected reader.
 * Looks at the specs the run declares; the FIRST declared property wins, because a wave with two
 * core properties has no core property and that is a spec bug, not something to average out.
 */
export function findCoreProperty(specTexts = []) {
  for (const text of specTexts) {
    const m = /^\s*core[-_]?[Pp]roperty:\s*(\S.*?)\s*$/m.exec(String(text ?? ''));
    if (!m) continue;
    const v = m[1].trim().replace(/^["']|["']$/g, '');
    if (v && v !== 'TODO' && v !== '?') return v;
  }
  return null;
}

/**
 * The verdict. `detect` is injected so this file never re-implements the detection that
 * replan-ledger already owns — one detector, one bar.
 * @returns {{block:boolean, reason:string, signals:Array}}
 */
export function tripwireVerdict({ tool = '', input = {}, coreProperty = null } = {}, detect) {
  if (!coreProperty) return { block: false, reason: 'у волны не объявлено несущее свойство — проверять не против чего', signals: [] };
  const content = actionContent(input);
  if (!content.trim()) return { block: false, reason: 'действие не несёт содержимого', signals: [] };
  if (typeof detect !== 'function') return { block: false, reason: 'детектор недоступен — пропускаем, а не гадаем', signals: [] };

  const signals = detect(coreProperty, content) || [];
  if (!signals.length) return { block: false, reason: 'признаков подмены каркасом нет', signals: [] };
  const s = signals[0];
  return {
    block: true,
    signals,
    reason: `GUARDRAIL-TRIPWIRE: несущее свойство волны требует «${s.demand}», а записываемое содержимое показывает «${s.scaffold}» и нигде не демонстрирует это качество. `
      + `Это подмена несущего свойства каркасом — класс, который владелец назвал 2026-07-04. `
      + `Останавливаюсь СЕЙЧАС, а не на приёмке: между двумя решениями контроллера успевает написаться много файлов. `
      + `Если каркас здесь намеренный шаг к свойству, скажи это явно в сообщении и продолжай.`,
  };
}

function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  // the real detector, not a stand-in: if it changes, this test changes with it
  const detect = (cp, ev) => realDetect(cp, ev);

  ok('content is read from `content`', actionContent({ content: 'x' }) === 'x');
  ok('content is read from an edit replacement too', actionContent({ new_string: 'y' }) === 'y');
  ok('a path-only action carries no content', actionContent({ file_path: 'a.ts' }) === '');

  ok('the core property is read from the spec field',
    findCoreProperty(['---\ncoreProperty: среда должна быть недетерминированной\n---']) === 'среда должна быть недетерминированной');
  ok('the FIRST declared property wins', findCoreProperty(['coreProperty: a', 'coreProperty: b']) === 'a');
  ok('a TODO placeholder is not a declaration', findCoreProperty(['coreProperty: TODO']) === null);
  ok('no spec at all → no property', findCoreProperty([]) === null);

  const CP = 'среда должна быть недетерминированной, отвечать любыми словами';
  ok('scaffolding against a dynamic demand trips the wire',
    tripwireVerdict({ tool: 'Write', input: { content: 'intent matched via regex template, plain-text fallback list' }, coreProperty: CP }, detect).block === true);
  ok('a real dynamic implementation does NOT trip it',
    tripwireVerdict({ tool: 'Write', input: { content: 'model generates the decision at runtime, non-deterministic across phrasings' }, coreProperty: CP }, detect).block === false);
  ok('the block names both the demand and the scaffold', (() => {
    const v = tripwireVerdict({ tool: 'Write', input: { content: 'hardcoded stub list' }, coreProperty: 'the assistant must generate answers to any words' }, detect);
    return v.block && /требует/.test(v.reason) && /показывает/.test(v.reason);
  })());

  // fail-open, three ways: a tripwire that guesses gets switched off
  ok('no core property → never blocks', tripwireVerdict({ tool: 'Write', input: { content: 'anything' }, coreProperty: null }, detect).block === false);
  ok('no content → never blocks', tripwireVerdict({ tool: 'Write', input: { file_path: 'a.ts' }, coreProperty: CP }, detect).block === false);
  ok('no detector → never blocks, and says so',
    tripwireVerdict({ tool: 'Write', input: { content: 'regex template' }, coreProperty: CP }, null).block === false);

  if (fails) { console.log(`\n\x1b[31mguardrail-tripwire self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ guardrail-tripwire: halts scaffold-substitution per action, fails open everywhere else\x1b[0m');
  process.exit(0);
}

// ── wiring ──────────────────────────────────────────────────────────────────
let realDetect = null;
// подгрузка детектора — работа, поэтому только при прямом запуске хука
async function loadDetector() {
  try {
    ({ coreSubstitutionSignals: realDetect } = await import(path.join(ROOT, 'scripts', 'replan-ledger.mjs')));
  } catch { /* detector unavailable → the hook fails open below */ }
}



function specTextsForRun() {
  // The specs of the project being WORKED ON, not of the framework. Registered globally, the hook
  // fires in every repo; reading the engine's own specs there would judge one project's action
  // against another project's core property — a confident, wrong block, which is worse than none.
  const out = [];
  const dir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'docs', 'specs');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      try { out.push(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* skip */ }
    }
  } catch { /* no specs → fail open */ }
  return out;
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }

  const tool = payload.tool_name || payload.tool || '';
  if (!/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool) && !tool.startsWith('mcp__')) process.exit(0);

  const coreProperty = findCoreProperty(specTextsForRun());
  const v = tripwireVerdict({ tool, input: payload.tool_input || {}, coreProperty }, realDetect);
  if (!v.block) process.exit(0);
  process.stderr.write(v.reason + '\n');
  process.exit(2);
}

// Guarded. The FIRST version of this very file called main() unconditionally, so importing it to
// prove it works hung forever on reading stdin — the fourth import-side-effect of the day, and this
// one I wrote myself while fixing the other three. A hook is a program AND a module; only the
// program half may do work.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  await loadDetector();
  if (process.argv.includes('--self-test')) selfTest();
  main();
}
