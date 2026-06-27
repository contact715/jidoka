#!/usr/bin/env node
/**
 * clarify-engine — the structured business-question (elicitation) engine.
 *
 * Closes the one pipeline phase with NO forcing function (research 2026-06-24,
 * docs/research/2026-06-24_github-enrichment-research.md, gap #2). dev-pipeline
 * step 1 ("clarify business logic via AskUserQuestion") was prose: no taxonomy
 * of WHAT to ask, no ordering, no completeness scoring, no write-back. "Talk to
 * the user" was voluntary agent behaviour — exactly the layer spec-first-gate
 * was built to replace ("a rule is only real if a mechanism fires without
 * voluntary compliance").
 *
 * This engine turns elicitation into a verifiable STATE with a stop criterion a
 * gate can read: a 9-category coverage taxonomy where each category is scored
 * Missing / Partial / Clear / Deferred, impact-by-uncertainty question ordering,
 * a bounded ask loop, atomic write-back to a versioned ## Clarifications section,
 * and a machine-readable coverage JSON + an append-only trace.
 *
 * It does NOT itself talk to the user — the harness AskUserQuestion primitive
 * does, driven by the CPO / business-process-architect / user-researcher roles.
 * The engine records and scores the answers and exposes the completeness state
 * that clarify-gate.mjs enforces before the spec phase.
 *
 * Method ported (idea only, no dependency) from github/spec-kit /clarify and the
 * Mom Test (ask about past concrete behaviour, never hypotheticals).
 *
 * Usage:
 *   node scripts/clarify-engine.mjs --feature <name> --status
 *   node scripts/clarify-engine.mjs --feature <name> --plan          # next questions, ordered
 *   node scripts/clarify-engine.mjs --feature <name> --answer <cat> "text"
 *   node scripts/clarify-engine.mjs --feature <name> --defer  <cat> "reason"
 *   node scripts/clarify-engine.mjs --feature <name> --json          # coverage as JSON
 *   node scripts/clarify-engine.mjs --self-test
 *
 * Honest limit: like spec-first-gate, this verifies the elicitation STATE was
 * recorded and is complete, not that the answers are wise. It is a forcing
 * function, not a proof of judgement.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// 9-category taxonomy. impact = base business weight; the Mom-Test note steers
// the human asker toward concrete-past phrasing for the behavioural categories.
export const TAXONOMY = [
  { key: 'problem', title: 'Проблема / job-to-be-done', impact: 1.0,
    prompt: 'Какую конкретную проблему решаем и чья она? Что человек делает сейчас вместо этого?',
    momTest: true },
  { key: 'users', title: 'Пользователи и роли', impact: 0.9,
    prompt: 'Кто именно пользователи, какие роли, кто принимает решение о ценности?' },
  { key: 'value-metric', title: 'Бизнес-метрика и измерение', impact: 1.0,
    prompt: 'Какую бизнес-метрику это двигает (конверсия/скорость/выручка/удержание) и как мы измерим улучшение?' },
  { key: 'scope', title: 'Объём: что входит и что НЕ входит', impact: 0.8,
    prompt: 'Что входит в эту задачу, а что явно вне её (не-цели)?' },
  { key: 'constraints', title: 'Ограничения', impact: 0.8,
    prompt: 'Ограничения: бюджет, сроки, технологии, регуляторика, PII/секреты?' },
  { key: 'data', title: 'Данные и сущности', impact: 0.7,
    prompt: 'Какие данные/сущности задействованы, откуда берутся, кто владелец?' },
  { key: 'edge-cases', title: 'Краевые случаи и ошибки', impact: 0.7,
    prompt: 'Краевые случаи: пустые/предельные состояния, ошибки, что при сбое?',
    momTest: true },
  { key: 'success-criteria', title: 'Критерии приёмки (DoD)', impact: 0.9,
    prompt: 'Как поймём, что готово и работает? Наблюдаемые критерии приёмки.' },
  { key: 'risks-deps', title: 'Риски и зависимости', impact: 0.6,
    prompt: 'Главные риски и внешние зависимости — что может сломаться или заблокировать?' },
];

const STATES = ['missing', 'partial', 'clear', 'deferred'];
const UNCERTAINTY = { missing: 1.0, partial: 0.5, clear: 0, deferred: 0 };

export function newCoverage(feature) {
  const categories = {};
  for (const c of TAXONOMY) categories[c.key] = { state: 'missing', answer: '', reason: '' };
  return { feature, categories, updatedAt: null };
}

/** Pending categories ordered by impact × uncertainty (desc). */
export function questionPlan(coverage) {
  return TAXONOMY
    .map((c) => {
      const cur = coverage.categories[c.key] || { state: 'missing' };
      const score = c.impact * (UNCERTAINTY[cur.state] ?? 1.0);
      return { ...c, state: cur.state, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function applyAnswer(coverage, category, text, opts = {}) {
  if (!coverage.categories[category]) throw new Error(`unknown category: ${category}`);
  const defer = !!opts.defer;
  if (defer) {
    if (!String(text).trim()) throw new Error('defer requires a reason');
    coverage.categories[category] = { state: 'deferred', answer: '', reason: String(text).trim() };
  } else {
    const t = String(text).trim();
    // A one-liner is partial; a substantive answer (>= 40 chars) is clear.
    coverage.categories[category] = { state: t.length >= 40 ? 'clear' : 'partial', answer: t, reason: '' };
  }
  return coverage;
}

export function summary(coverage) {
  const counts = { missing: 0, partial: 0, clear: 0, deferred: 0 };
  for (const c of TAXONOMY) counts[coverage.categories[c.key]?.state || 'missing']++;
  // Complete = every category resolved (clear) or explicitly deferred-with-reason.
  const complete = TAXONOMY.every((c) => {
    const cur = coverage.categories[c.key];
    return cur && (cur.state === 'clear' || (cur.state === 'deferred' && cur.reason));
  });
  return { ...counts, total: TAXONOMY.length, complete };
}

export function renderClarificationsMd(coverage) {
  const lines = [`## Clarifications`, '', `_Feature: ${coverage.feature} · обновлено: ${coverage.updatedAt || 'n/a'}_`, ''];
  for (const c of TAXONOMY) {
    const cur = coverage.categories[c.key] || { state: 'missing' };
    const mark = { clear: '✓', partial: '~', missing: '✗', deferred: '⏸' }[cur.state];
    lines.push(`### ${mark} ${c.title}  (\`${c.key}\` — ${cur.state})`);
    if (cur.state === 'deferred') lines.push(`> Отложено: ${cur.reason}`);
    else if (cur.answer) lines.push(cur.answer);
    else lines.push(`_не отвечено_ — ${c.prompt}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---- file layout ----
const COVERAGE_PATH = (f) => `docs/audits/clarify/${slug(f)}.json`;
const MD_PATH = (f) => `docs/specs/clarifications/${slug(f)}.md`;
const TRACE = 'docs/audits/clarify-runs.jsonl';
const slug = (f) => String(f).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');

function ensureDir(p) { mkdirSync(dirname(p), { recursive: true }); }
function loadCoverage(feature) {
  const p = COVERAGE_PATH(feature);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { /* fall through */ } }
  return newCoverage(feature);
}
function saveCoverage(cov, nowIso) {
  cov.updatedAt = nowIso;
  ensureDir(COVERAGE_PATH(cov.feature));
  writeFileSync(COVERAGE_PATH(cov.feature), JSON.stringify(cov, null, 2) + '\n');
  ensureDir(MD_PATH(cov.feature));
  writeFileSync(MD_PATH(cov.feature), renderClarificationsMd(cov));
}
function trace(rec) {
  ensureDir(TRACE);
  appendFileSync(TRACE, JSON.stringify(rec) + '\n');
}

function arg(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const feature = arg(args, '--feature');
  if (!feature) { console.error('clarify-engine: --feature <name> required'); process.exit(2); }
  const nowIso = new Date().toISOString();
  const cov = loadCoverage(feature);

  if (args.includes('--json')) { process.stdout.write(JSON.stringify({ ...cov, summary: summary(cov) }, null, 2) + '\n'); return; }

  if (args.includes('--plan')) {
    const plan = questionPlan(cov);
    const s = summary(cov);
    console.log(`clarify "${feature}": ${s.clear}✓ ${s.partial}~ ${s.missing}✗ ${s.deferred}⏸ — ${s.complete ? 'COMPLETE' : 'incomplete'}`);
    if (!plan.length) { console.log('  все категории закрыты.'); return; }
    console.log('  следующие вопросы (по impact × uncertainty):');
    for (const c of plan) console.log(`  • [${c.key}] ${c.title}\n      ${c.prompt}${c.momTest ? '  (Mom Test: спрашивай про прошлое поведение, не гипотезы)' : ''}`);
    return;
  }

  const ansCat = arg(args, '--answer');
  const defCat = arg(args, '--defer');
  if (ansCat || defCat) {
    const cat = ansCat || defCat;
    const text = args[args.indexOf(ansCat ? '--answer' : '--defer') + 2] || '';
    applyAnswer(cov, cat, text, { defer: !!defCat });
    saveCoverage(cov, nowIso);
    const s = summary(cov);
    trace({ ts: nowIso, feature, action: defCat ? 'defer' : 'answer', category: cat, complete: s.complete, summary: s });
    console.log(`clarify "${feature}": ${cat} → ${cov.categories[cat].state}. Покрытие: ${s.clear}/${s.total} clear, complete=${s.complete}`);
    return;
  }

  // default: --status
  const s = summary(cov);
  console.log(`clarify "${feature}": ${s.clear}✓ clear, ${s.partial}~ partial, ${s.missing}✗ missing, ${s.deferred}⏸ deferred — ${s.complete ? 'COMPLETE' : 'INCOMPLETE'}`);
  console.log(`  coverage: ${COVERAGE_PATH(feature)}  ·  md: ${MD_PATH(feature)}`);
  if (!s.complete) console.log('  → node scripts/clarify-engine.mjs --feature ' + feature + ' --plan');
}

function selfTest() {
  let fail = 0;
  const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); fail++; } };
  console.log('clarify-engine --self-test');

  const cov = newCoverage('demo');
  ok(summary(cov).missing === TAXONOMY.length, 'fresh coverage: all categories missing');
  ok(!summary(cov).complete, 'fresh coverage is not complete');

  const plan = questionPlan(cov);
  ok(plan.length === TAXONOMY.length, 'plan lists every pending category');
  ok(plan[0].score >= plan[plan.length - 1].score, 'plan ordered by score desc');
  ok(plan[0].impact === 1.0, 'highest-impact category surfaces first');

  applyAnswer(cov, 'problem', 'one-liner');
  ok(cov.categories.problem.state === 'partial', 'short answer → partial');
  applyAnswer(cov, 'problem', 'A substantive, concrete description of the real problem and current workaround.');
  ok(cov.categories.problem.state === 'clear', 'substantive answer → clear');

  let threw = false;
  try { applyAnswer(cov, 'nope', 'x'); } catch { threw = true; }
  ok(threw, 'unknown category throws');

  let threw2 = false;
  try { applyAnswer(cov, 'data', '', { defer: true }); } catch { threw2 = true; }
  ok(threw2, 'defer without reason throws');

  applyAnswer(cov, 'data', 'не нужно для MVP', { defer: true });
  ok(cov.categories.data.state === 'deferred' && cov.categories.data.reason, 'defer-with-reason records reason');

  // Drive to complete.
  for (const c of TAXONOMY) {
    if (cov.categories[c.key].state === 'clear' || cov.categories[c.key].state === 'deferred') continue;
    applyAnswer(cov, c.key, 'A substantive, concrete answer long enough to count as clear coverage here.');
  }
  ok(summary(cov).complete, 'all-resolved coverage is complete');

  const md = renderClarificationsMd(cov);
  ok(md.includes('## Clarifications') && md.includes('problem'), 'markdown render includes section + a category');

  console.log(fail === 0 ? '\nclarify-engine: all self-tests passed' : `\nclarify-engine: ${fail} self-test(s) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

// Run only when invoked directly — importing for tests must not trigger main()/exit.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
