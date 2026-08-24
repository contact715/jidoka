#!/usr/bin/env node
// kaizen-audit — deterministic outcome auditor of the weekly Kaizen engine (Phase 1b).
//
// Closes the loop: for each ledger entry it checks the LIVE repo whether the recommendation's
// point-of-integration actually landed, and sets status shipped / open / regressed with evidence.
// No LLM, no guessing — a recommendation is "shipped" only when its concrete artifact is really
// present (a script file exists, or its name is referenced in the CI workflow). This is what makes
// the weekly adoption-rate honest instead of self-reported.
//
// pointOfIntegration forms understood:
//   - a path        "scripts/dag-schedule.mjs" / "docs/X.md"     → present iff the file exists
//   - a bare token  "map-ac-coverage" / "button-has-type"        → present iff CI text references
//                                                                    it OR scripts/<token>.mjs exists
//
// Pure core (auditEntry / auditLedger) takes injected probes so it is fully testable offline.
//
// Usage:
//   node scripts/kaizen-audit.mjs [--file <ledger>] [--week 2026-W27] [--dry]
//   node scripts/kaizen-audit.mjs --self-test

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLedger, writeLedger, upsert, DEFAULT_LEDGER } from './kaizen-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const looksLikePath = (poi) => /[\\/]/.test(poi) || /\.[a-z0-9]+$/i.test(poi);

// probe-form-point-of-integration (2026-W32-R5) — a bare file path proves NOTHING about a
// recommendation that EDITS that file: the file already exists, so the audit stamps "shipped"
// the moment the recommendation is written down. Measured on 2026-08-03: 19 freshly-proposed
// W32 entries carrying real file paths flipped 14 to "shipped" instantly and pushed the
// dashboard from 28% to 39% with zero lines of code written. The opposite form (a bare
// sentinel word) fails the other way: 33 of 59 ledger entries used it and NOT ONE could ever
// resolve, so 32 were locked in "open" forever and one was falsely reported "regressed".
//
// The fix is the third form: "path/to/file.ext#anchor". The file must exist AND literally
// contain the anchor string. The anchor is a CONTRACT — whoever implements the recommendation
// leaves that exact marker (a comment, an identifier, a line of prose) in the file, so the
// audit checks the capability rather than the container.
export function splitPoi(poi = '') {
  const i = poi.indexOf('#');
  return i === -1 ? { path: poi, anchor: '' } : { path: poi.slice(0, i), anchor: poi.slice(i + 1) };
}

// ── anchor-must-be-code-not-comment (2026-W33-R1) ───────────────────────────
// An anchor used to be confirmed by `body.includes(anchor)`, so a comment counted as proof. The
// author of a fix writes both the fix and the comment, which makes the evidence self-issued.
// Evidence now has a TIER, and the weakest tier is reported as such instead of being rounded up.
//
// SCOPE, stated plainly: this changes ANCHORED entries only. Entries that address a code file by
// bare path are weaker still (the file existed before the recommendation was written), and they
// are already counted as visible debt by kaizen-ledger.legacyAnchorDebt(). Two demotions in one
// move would be one unverified claim stacked on another.
const CODE_FILE = /\.(mjs|js|cjs|ts|sh)$/i;
const SHELL_FILE = /\.sh$/i;
const kebabToCamel = (s) => s.replace(/-+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isCommentLine = (line, shell) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || (shell && t.startsWith('#'));
};

/**
 * How strongly does `body` prove that `anchor` names a real capability?
 *   'symbol'  — the file DEFINES an identifier with that name (strongest)
 *   'code'    — the anchor appears on a line that is not a comment
 *   'comment' — the anchor appears only inside a comment (a label, not behaviour)
 *   'absent'  — not there at all
 * Prose and data files (.md/.json/.jsonl/.yml) have no comment tier: their text IS the artifact.
 */
/**
 * 2026-W35-A10 — ПУСТОЙ символ это не доказательство.
 *
 * Возвращает true, если объявление есть, а работы в нём нет: пустое тело, значение
 * null/undefined, или заглушка «not implemented». Разбор нарочно текстовый и грубый:
 * задача не в том, чтобы понять код, а в том, чтобы отличить «написано» от «названо».
 * Ошибаться этот разбор обязан в СТРОГУЮ сторону — сомнительное считаем настоящим,
 * потому что ложное понижение объявляет построенное непостроенным, а это та же ложь
 * наизнанку (урок 2026-08-11).
 *
 * @param {string} body исходник файла
 * @param {string} name имя символа
 * @returns {boolean}
 */
export function isStubDefinition(body, name) {
  const n = escapeRe(name);
  // const x = null | undefined
  if (new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${n}\\s*=\\s*(?:null|undefined)\\s*[;\\n]`).test(body)) return true;
  // function x(...) {}  — пустое тело, возможно с пробелами и переводами строк
  if (new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${n}\\s*\\([^)]*\\)\\s*\\{\\s*\\}`).test(body)) return true;
  // const x = (...) => {}  — пустая стрелка
  if (new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${n}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{\\s*\\}`).test(body)) return true;
  // тело состоит только из throw «не реализовано»
  if (new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${n}\\s*\\([^)]*\\)\\s*\\{\\s*throw[^}]*\\}`).test(body)) {
    const m = body.match(new RegExp(`function\\s+${n}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\}`));
    if (m && /not\s*implemented|не\s*реализ|TODO/i.test(m[1])) return true;
  }
  return false;
}

/** Сила уровня доказательства. Прогон сильнее объявления, объявление сильнее заглушки. */
export function tierRank(tier) {
  return { executed: 5, symbol: 4, code: 3, stub: 2, comment: 1, absent: 0, 'check-failed': 0, 'no-check': 0 }[tier] ?? 0;
}

/**
 * 2026-W35-A10 — единственный уровень, доказывающий ПОВЕДЕНИЕ, а не наличие имени.
 *
 * Запись реестра может нести поле `check` — команду, которая доказывает, что работа
 * работает. Прогон намеренно НЕ делается на каждом аудите: исполнять строки из файла
 * дорого и небезопасно, поэтому это отдельный режим `--verify-checks`. Отсутствие
 * команды это честное `no-check`, а не молчаливое «сойдёт».
 *
 * @param {{check?:string}} entry
 * @param {(cmd:string)=>{ok:boolean,out?:string}} runner
 */
export function executedEvidence(entry, runner) {
  const cmd = entry && typeof entry.check === 'string' ? entry.check.trim() : '';
  if (!cmd) return { tier: 'no-check', cmd: null, out: '' };
  const r = runner(cmd) || { ok: false };
  return { tier: r.ok ? 'executed' : 'check-failed', cmd, out: String(r.out || '').slice(0, 400) };
}

export function anchorEvidence(body, anchor, filePath = '') {
  if (typeof body !== 'string' || !anchor) return 'absent';
  const names = [...new Set([anchor, kebabToCamel(anchor)])];
  const isCode = CODE_FILE.test(filePath);
  if (isCode) {
    for (const n of names) {
      const def = new RegExp(`(?:^|[^\\w$])(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${escapeRe(n)}(?![\\w$])`);
      // Объявление найдено. Но объявление это ИМЯ, а не поведение: пустая функция,
      // null и заглушка throw проходили как сильнейшее доказательство до 2026-W35-A10.
      if (def.test(body)) return isStubDefinition(body, n) ? 'stub' : 'symbol';
    }
  }
  const shell = SHELL_FILE.test(filePath);
  let sawComment = false;
  for (const line of body.split('\n')) {
    if (!names.some((n) => line.includes(n))) continue;
    if (!isCode || !isCommentLine(line, shell)) return 'code'; // a real line wins immediately
    sawComment = true;
  }
  return sawComment ? 'comment' : 'absent';
}

/**
 * Resolve a point-of-integration to an evidence tier against the live repo.
 * Non-anchored forms keep their previous meaning and resolve to 'code' when present.
 */
export function resolvePoi(poi, probes = {}) {
  if (!poi) return 'absent';
  const exists = probes.exists || (() => false);
  const read = probes.read || (() => null);
  const { path: file, anchor } = splitPoi(poi);
  if (anchor) {
    if (!exists(file)) return 'absent';
    return anchorEvidence(read(file), anchor, file);
  }
  return isPresent(poi, probes) ? 'code' : 'absent';
}

/**
 * Decide whether a point-of-integration is present in the repo.
 * @param {string} poi
 * @param {{exists:(rel:string)=>boolean, read?:(rel:string)=>string|null, ciText?:string}} probes
 */
export function isPresent(poi, probes) {
  if (!poi) return false;
  const exists = probes.exists || (() => false);
  const read = probes.read || (() => null);
  const ciText = probes.ciText || '';
  const { path: file, anchor } = splitPoi(poi);
  if (anchor) {
    // capability anchor: the container must exist AND carry the marker
    if (!exists(file)) return false;
    const body = read(file);
    return typeof body === 'string' && body.includes(anchor);
  }
  if (looksLikePath(file)) return exists(file);
  // bare token → a gate/rule name: referenced in CI, or backed by a same-named script
  return ciText.includes(file) || exists(`scripts/${file}.mjs`);
}

/**
 * Audit one entry against the live repo. Pure.
 * @returns {object} a possibly-updated entry (never mutates the input)
 */
export function auditEntry(entry, probes = {}, week = '') {
  if (!entry || entry.status === 'rejected') return { ...entry }; // never re-audit a rejected one
  const tier = resolvePoi(entry.pointOfIntegration, probes);
  const wasShipped = entry.status === 'shipped' || !!entry.shippedWeek;

  if (tier === 'symbol' || tier === 'code') {
    return { ...entry, status: 'shipped', shippedWeek: entry.shippedWeek || week || entry.week, evidence: `present (${tier}): ${entry.pointOfIntegration}` };
  }
  if (tier === 'stub') {
    // 2026-W35-A10 — символ есть, работы в нём нет. НЕ регресс (ничего не удаляли) и НЕ
    // внедрение: тот же честный статус, что у комментария, потому что доказательная сила
    // та же — названо, но не сделано.
    return {
      ...entry,
      status: 'attested',
      evidence: `символ объявлен, но пуст: ${entry.pointOfIntegration} — тело заглушка (пусто / null / not implemented); докажи прогоном через поле check`,
    };
  }
  if (tier === 'comment') {
    // The label exists, the proof does not point at behaviour. NOT a regression: nothing was
    // removed, the bar moved. shippedWeek is preserved so history is not rewritten.
    return {
      ...entry,
      status: 'attested',
      evidence: `только комментарий, не код: ${entry.pointOfIntegration} — доказательство написано автором починки рядом с ней; направь якорь на символ`,
    };
  }
  if (wasShipped) {
    return { ...entry, status: 'regressed', evidence: `MISSING now (was shipped): ${entry.pointOfIntegration}` };
  }
  // audited and absent, never shipped → open (distinct from the initial 'proposed')
  return { ...entry, status: 'open', evidence: `not yet present: ${entry.pointOfIntegration}` };
}

export function auditLedger(entries = [], probes = {}, week = '') {
  return entries.map((e) => auditEntry(e, probes, week));
}

// ── dashboard-regenerated-from-ledger (2026-W33-R9) ──────────────────────────
// The dashboard is a RENDER of the ledger, but nothing regenerated it after an audit, so it drifted
// and was believed anyway. Measured 2026-08-10: the panel printed "adoption 31% · shipped 24/77"
// while the ledger held 54 of 79. Both numbers were wrong by then, in opposite directions, and the
// weekly report quoted the panel. A view that can disagree with its source is a second source.
const DASH_COUNTS = /shipped\s+(\d+)\s*\/\s*(\d+)/;

/**
 * Does the rendered dashboard still agree with the ledger it claims to render?
 * Compares only the counts it prints — the parts a reader quotes. Pure.
 * @returns {{stale:boolean, was:string|null, now:string}}
 */
export function dashboardStale(card = {}, dashboardText = '') {
  const now = `${card.shippedCount ?? 0}/${card.actionable ?? 0}`;
  const m = DASH_COUNTS.exec(String(dashboardText || ''));
  const was = m ? `${m[1]}/${m[2]}` : null;
  return { stale: was !== now, was, now };
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  const exists = (p) => p === 'scripts/dag-schedule.mjs' || p === 'scripts/map-ac-coverage.mjs';
  const ciText = 'run: node scripts/dag-schedule.mjs --self-test\n- name: button-has-type gate';
  const FILES = { 'scripts/dag-schedule.mjs': 'export function buildDag(tasks) { return tasks.map(criticalPath); } // critical-path-edges' };
  const read = (p) => (p in FILES ? FILES[p] : null);
  const probes = { exists, read, ciText };
  const W = '2026-W28';

  // present by path → shipped, stamps shippedWeek
  const a = auditEntry({ id: 'r1', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs', status: 'proposed', shippedWeek: null }, probes, W);
  ok('present-by-path → shipped', a.status === 'shipped');
  ok('shipped stamps shippedWeek (audit week)', a.shippedWeek === W);
  // evidence now names the TIER it was proven at (symbol / code), so a reader can tell how strong it is
  ok('shipped carries evidence naming its tier', /present \((symbol|code)\):/.test(a.evidence));

  // present by bare token in CI → shipped
  const b = auditEntry({ id: 'r2', week: '2026-W27', title: 't', pointOfIntegration: 'button-has-type', status: 'proposed', shippedWeek: null }, probes, W);
  ok('bare token referenced in CI → shipped', b.status === 'shipped');

  // present by bare token backed by a same-named script → shipped
  const c = auditEntry({ id: 'r3', week: '2026-W27', title: 't', pointOfIntegration: 'map-ac-coverage', status: 'proposed', shippedWeek: null }, probes, W);
  ok('bare token backed by scripts/<token>.mjs → shipped', c.status === 'shipped');

  // absent, never shipped → open
  const d = auditEntry({ id: 'r4', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/ghost.mjs', status: 'proposed', shippedWeek: null }, probes, W);
  ok('absent + never shipped → open', d.status === 'open');

  // absent, was shipped → regressed
  const e = auditEntry({ id: 'r5', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/ghost.mjs', status: 'shipped', shippedWeek: '2026-W20' }, probes, W);
  ok('absent + was shipped → regressed', e.status === 'regressed');
  ok('regressed keeps evidence of the loss', /MISSING now/.test(e.evidence));

  // rejected is never re-audited
  const f = auditEntry({ id: 'r6', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs', status: 'rejected' }, probes, W);
  ok('rejected entry is left untouched', f.status === 'rejected');

  // shipped stays shipped, keeps original shippedWeek
  const g = auditEntry({ id: 'r7', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs', status: 'shipped', shippedWeek: '2026-W27' }, probes, W);
  ok('already-shipped keeps its original shippedWeek', g.shippedWeek === '2026-W27');

  // purity: input not mutated
  const input = { id: 'r8', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs', status: 'proposed', shippedWeek: null };
  auditEntry(input, probes, W);
  ok('auditEntry does not mutate its input', input.status === 'proposed');

  // audited entries still validate against the ledger schema (compose with upsert)
  ok('audited entry round-trips through upsert', (() => { try { upsert([], { ...a }); return true; } catch { return false; } })());

  // ── probe form: path#anchor (2026-W32-R5) ────────────────────────────────
  ok('splitPoi separates container from anchor',
    splitPoi('scripts/x.mjs#cap-a').path === 'scripts/x.mjs' && splitPoi('scripts/x.mjs#cap-a').anchor === 'cap-a');
  ok('splitPoi leaves a plain path untouched', splitPoi('scripts/x.mjs').anchor === '');

  // THE case the old auditor got wrong: the file exists, the capability does not.
  const h = auditEntry({ id: 'r9', week: '2026-W32', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs#union-ledger-read', status: 'proposed', shippedWeek: null }, probes, W);
  ok('anchor absent in an EXISTING file → open, not shipped', h.status === 'open');

  // anchor present → really shipped
  const i2 = auditEntry({ id: 'r10', week: '2026-W32', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs#critical-path-edges', status: 'proposed', shippedWeek: null }, probes, W);
  ok('anchor present in the file → shipped', i2.status === 'shipped');

  // missing container with an anchor → open (never a crash)
  const j = auditEntry({ id: 'r11', week: '2026-W32', title: 't', pointOfIntegration: 'scripts/ghost.mjs#whatever', status: 'proposed', shippedWeek: null }, probes, W);
  ok('anchor on a missing file → open', j.status === 'open');

  // an anchor form whose container has no slash and a non-ascii tail must NOT fall through to token mode
  ok('anchor form is decided before the path heuristic',
    isPresent('README.md#224 скрипта', { exists: (p) => p === 'README.md', read: () => 'блаблабла 224 скрипта тут', ciText: '' }) === true);
  ok('same container, wrong anchor → absent',
    isPresent('README.md#224 скрипта', { exists: (p) => p === 'README.md', read: () => '223 скрипта', ciText: '' }) === false);

  // ── anchor-must-be-code-not-comment (2026-W33-R1) ────────────────────────
  // Measured 2026-08-10: of 35 anchored entries, 31 anchors sat on a COMMENT line and 4 on real
  // code. The audit was reading a label that the author of the fix had typed next to their own
  // work, so "adoption 69%" meant "69% of entries have a word written near them". That is
  // declaration-over-implementation, the one class the engine has never closed, living inside the
  // instrument that measures it.
  //
  // The fix is NOT a binary flip. Demoting 31 entries to "open" would claim built things are
  // unbuilt, which is the same error mirrored — and several of them are demonstrably built.
  // So evidence gets a TIER and the weak tier gets its own honest status.
  const CODE = 'scripts/x.mjs';
  const evi = (body, anchor, file = CODE) => anchorEvidence(body, anchor, file);
  ok('a DEFINED symbol is the strongest evidence',
    evi('export function reverseRemedyAudit(x) { return audit(x); }', 'reverseRemedyAudit') === 'symbol');
  ok('a kebab-case anchor matches its camelCase definition',
    evi('export function reverseRemedyAudit(x) { return audit(x); }', 'reverse-remedy-audit') === 'symbol');
  ok('const and class definitions count as symbols',
    evi('const myThing = 1', 'my-thing') === 'symbol' && evi('class MyThing {}', 'MyThing') === 'symbol');
  ok('the anchor on a non-comment line is code-tier',
    evi('if (mode === "step-outcome-taxonomy") {}', 'step-outcome-taxonomy') === 'code');
  ok('the anchor ONLY inside a // comment is comment-tier',
    evi('// step-outcome-taxonomy (2026-W33-R2)\nconst a = 1', 'step-outcome-taxonomy') === 'comment');
  ok('a block-comment line is also comment-tier', evi(' * anchor-here explained\ncode()', 'anchor-here') === 'comment');
  ok('a shell # comment is comment-tier', evi('# my-anchor\necho hi', 'my-anchor', 'scripts/x.sh') === 'comment');
  ok('absent anchor is absent', evi('nothing relevant', 'my-anchor') === 'absent');

  // ── 2026-W35-A10: имя резолвится ≠ работа сделана ─────────────────────────
  // Замер 2026-08-24: anchorEvidence отдавал сильнейший уровень `symbol` в четырёх
  // случаях из четырёх, включая три пустышки — пустое тело, значение null и заглушку
  // throw. Прибор доказывал существование ИМЕНИ, а не поведения. Это третий слой одной
  // дыры: 2026-08-11 засчитывался комментарий, W34-R12 поймала засчитанный СУЩЕСТВУЮЩИЙ
  // символ, здесь — засчитанный ПУСТОЙ. Каждая правка поднимала планку на ступень, и
  // класс переживал её.
  ok('ПУСТОЕ тело функции это заглушка, а не доказательство',
    evi('export function fixThing() {}', 'fixThing') === 'stub');
  ok('значение null это заглушка',
    evi('export const fixThing = null;', 'fixThing') === 'stub');
  ok('throw not implemented это заглушка',
    evi('export function fixThing() { throw new Error("not implemented"); }', 'fixThing') === 'stub');
  ok('тело с настоящей работой остаётся сильнейшим уровнем',
    evi('export function fixThing(a) { return a * 2; }', 'fixThing') === 'symbol');
  ok('однострочная стрелка с телом это символ',
    evi('export const fixThing = (a) => a * 2;', 'fixThing') === 'symbol');
  ok('заглушка НЕ считается внедрением, но и не регрессом: статус attested',
    auditEntry(
      { id: 's1', week: '2026-W35', title: 't', pointOfIntegration: 'scripts/x.mjs#fixThing', status: 'open', shippedWeek: null },
      { exists: (p) => p === 'scripts/x.mjs', read: () => 'export function fixThing() {}', ciText: '' },
      W,
    ).status === 'attested');

  // executedEvidence — единственный уровень, который доказывает ПОВЕДЕНИЕ
  ok('запись без команды проверки не может быть доказана прогоном',
    executedEvidence({ pointOfIntegration: 'scripts/x.mjs#a' }, () => ({ ok: true })).tier === 'no-check');
  ok('прошедшая команда проверки даёт уровень executed',
    executedEvidence({ check: 'node scripts/x.mjs --self-test' }, () => ({ ok: true })).tier === 'executed');
  ok('упавшая команда проверки НЕ доказывает ничего',
    executedEvidence({ check: 'node scripts/x.mjs --self-test' }, () => ({ ok: false, out: 'FAILED' })).tier === 'check-failed');
  ok('executed сильнее symbol, а symbol сильнее stub',
    tierRank('executed') > tierRank('symbol') && tierRank('symbol') > tierRank('stub') && tierRank('stub') > tierRank('comment'));
  ok('code beats comment when the anchor appears in BOTH',
    evi('// my-anchor is why\nrun("my-anchor")', 'my-anchor') === 'code');
  // in prose and data files there is no code/comment distinction — the text IS the artifact
  ok('a markdown file has no comment tier', evi('some prose my-anchor here', 'my-anchor', 'docs/x.md') === 'code');
  ok('a jsonl row is code-tier', evi('{"id":"my-anchor"}', 'my-anchor', 'docs/a.jsonl') === 'code');

  const probesFor = (body) => ({ exists: () => true, read: () => body });
  const attested = auditEntry({ id: 'a', week: '2026-W33', title: 't', pointOfIntegration: `${CODE}#my-cap`, status: 'proposed' },
    probesFor('// my-cap explained\ncode()'), '2026-W33');
  ok('comment-only anchor → status attested', attested.status === 'attested');
  ok('attested evidence explains WHY it is weak', /комментар/i.test(attested.evidence));
  const proven = auditEntry({ id: 'b', week: '2026-W33', title: 't', pointOfIntegration: `${CODE}#myCap`, status: 'proposed' },
    probesFor('export function myCap() { return cap(); }'), '2026-W33');
  ok('symbol anchor → status shipped', proven.status === 'shipped');
  // the BAR changed, the code did not: demoting an entry is a measurement change, not a regression
  const demoted = auditEntry({ id: 'c', week: '2026-W30', title: 't', pointOfIntegration: `${CODE}#my-cap`, status: 'shipped', shippedWeek: '2026-W30' },
    probesFor('// my-cap\ncode()'), '2026-W33');
  ok('shipped → attested is NOT called a regression', demoted.status === 'attested');
  ok('demotion keeps the original shippedWeek (history is not rewritten)', demoted.shippedWeek === '2026-W30');
  const trulyGone = auditEntry({ id: 'd', week: '2026-W30', title: 't', pointOfIntegration: `${CODE}#my-cap`, status: 'shipped', shippedWeek: '2026-W30' },
    { exists: () => false, read: () => null }, '2026-W33');
  ok('shipped → absent is STILL a regression', trulyGone.status === 'regressed');
  // dashboard-regenerated-from-ledger (2026-W33-R9)
  ok('a dashboard printing the ledger counts is not stale',
    dashboardStale({ shippedCount: 59, actionable: 97 }, '**adoption 61% · shipped 59/97, open 38**').stale === false);
  ok('a dashboard printing OLD counts is stale, and names both numbers', (() => {
    const d = dashboardStale({ shippedCount: 59, actionable: 97 }, '**adoption 31% · shipped 24/77, open 53**');
    return d.stale === true && d.was === '24/77' && d.now === '59/97';
  })());
  ok('a dashboard with no counts at all reads as stale (never silently agreeable)',
    dashboardStale({ shippedCount: 1, actionable: 2 }, '# empty').stale === true);

  ok('an attested entry that later gains a symbol is promoted to shipped',
    auditEntry({ id: 'e', week: '2026-W33', title: 't', pointOfIntegration: `${CODE}#my-cap`, status: 'attested' },
      probesFor('export function myCap() { return cap(); }'), '2026-W33').status === 'shipped');

  if (fails) { console.log('\n\x1b[31mkaizen-audit self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-audit: deterministic shipped/open/regressed detection correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const file = arg('--file') || DEFAULT_LEDGER;
  const week = arg('--week') || isoWeek(new Date());
  const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
  const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
  let ciText = '';
  try { ciText = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'); } catch { /* no CI file */ }

  const before = readLedger(file);
  const after = auditLedger(before, { exists, read, ciText }, week);
  const changed = after.filter((e, i) => e.status !== before[i].status).length;
  console.log(`[kaizen-audit] ${after.length} entrie(s) audited @ ${week} — ${changed} status change(s):`);
  for (const e of after) console.log(`  ${e.status.padEnd(9)} ${e.id}  ${e.pointOfIntegration || ''}`);
  const shipped = after.filter((e) => e.status === 'shipped').length;
  const attested = after.filter((e) => e.status === 'attested').length;
  console.log(`  adoption: ${shipped}/${after.length} shipped${attested ? `, ${attested} attested (символ есть, поведение не доказано)` : ''}`);

  // ── 2026-W35-A10: доказательство ПРОГОНОМ, отдельным режимом ───────────────
  // Статический аудит доказывает, что имя разрешается. Что работа РАБОТАЕТ, доказывает
  // только запуск. Режим отдельный намеренно: исполнять команды из файла на каждом
  // аудите дорого и небезопасно, а гейт, который дорого стоит на каждом шаге, учат
  // обходить (класс gate-cost-not-proportional-to-change).
  if (process.argv.includes('--verify-checks')) {
    const { execSync } = await import('node:child_process');
    const run = (cmd) => {
      try { execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 120000 }); return { ok: true }; }
      catch (e) { return { ok: false, out: String(e.stdout || e.stderr || e.message) }; }
    };
    const withCheck = after.filter((e) => e.check);
    console.log(`\n[kaizen-audit --verify-checks] записей с командой проверки: ${withCheck.length} из ${after.length}`);
    let passed = 0, failed = 0;
    for (const e of withCheck) {
      const r = executedEvidence(e, run);
      if (r.tier === 'executed') { passed++; console.log(`  \x1b[32m✓ executed\x1b[0m ${e.id}  ${r.cmd}`); }
      else { failed++; console.log(`  \x1b[31m✗ ${r.tier}\x1b[0m ${e.id}  ${r.cmd}\n      ${r.out.split('\n').slice(-3).join(' / ')}`); }
    }
    const noCheck = after.filter((e) => e.status === 'shipped' && !e.check).length;
    console.log(`  доказано прогоном: ${passed} · упало: ${failed} · внедрено БЕЗ команды проверки: ${noCheck}`);
    if (failed) process.exit(1);
  }
  if (!process.argv.includes('--dry')) {
    writeLedger(after, file);
    console.log(`[kaizen-audit] ledger updated: ${path.relative(ROOT, file)}`);
    // dashboard-regenerated-from-ledger (2026-W33-R9): the view is rebuilt from the source that
    // was just written, so it cannot survive as a second, older opinion. The renderer lives in its
    // own module precisely so this import cannot close a cycle — the first attempt imported
    // kaizen-engine and deadlocked into an unsettled top-level await that exited 0 in silence.
    try {
      const dashPath = path.join(path.dirname(file), '_DASHBOARD.md');
      const [{ renderDashboard }, { scorecard }] = await Promise.all([
        import('./kaizen-dashboard.mjs'), import('./kaizen-scorecard.mjs'),
      ]);
      const card = scorecard(after);
      const before = fs.existsSync(dashPath) ? fs.readFileSync(dashPath, 'utf8') : '';
      const drift = dashboardStale(card, before);
      fs.writeFileSync(dashPath, renderDashboard(card, after, week), 'utf8');
      if (drift.stale) console.log(`[kaizen-audit] витрина была не в ногу с реестром (${drift.was ?? 'без чисел'} → ${drift.now}) и перегенерирована`);
      else console.log('[kaizen-audit] витрина перегенерирована, расхождения не было');
    } catch (e) {
      // fail-open: an audit that cannot redraw the view must still record the audit
      console.log(`[kaizen-audit] витрину перегенерировать не удалось (${e.message}) — реестр записан, панель могла устареть`);
    }
  } else console.log('[kaizen-audit] --dry: ledger not written');
  process.exit(0);
}

// ISO-8601 week string for the CLI (deterministic self-test injects the week instead).
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
