// Shared primitives for the Meta-Mistake Engine family (meta-audit, meta-trend,
// meta-premortem, meta-generalize, meta-decay). One loader, one date math, one
// grouping — so the engines can't drift apart on how they read the ledger.
//
// LEDGER is env-overridable (META_LEDGER) so every engine is testable against a
// synthetic ledger without mutating production data.

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Where this engine is INSTALLED decides where the ledger lives — no install-time
// path rewriting needed:
//   - framework repo / project install (.jidoka/scripts/) → the project-local ledger
//   - global install (~/.claude/jidoka/scripts/) → the GLOBAL cross-project ledger,
//     so a class caught in one repo is known to the engine in all repos.
// Both stay env-overridable (META_LEDGER / META_TRIP_LOG) so every engine is
// testable against a synthetic ledger without mutating production data.
const JIDOKA_HOME = process.env.JIDOKA_HOME || join(homedir(), '.claude', 'jidoka');
const IS_GLOBAL = dirname(fileURLToPath(import.meta.url)).startsWith(JIDOKA_HOME);
export const LEDGER = process.env.META_LEDGER || (IS_GLOBAL ? join(JIDOKA_HOME, 'meta-mistakes.jsonl') : 'docs/audits/meta-mistakes.jsonl');
export const TRIP_LOG = process.env.META_TRIP_LOG || (IS_GLOBAL ? join(JIDOKA_HOME, 'gate-trips.jsonl') : 'docs/audits/gate-trips.jsonl');

function loadJsonl(path, who) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); }
    catch { console.error(`${who}: skipping malformed line ${i + 1}`); return null; }
  }).filter(Boolean);
}

// union-ledger-read (2026-W32-R2) — the ledger address is decided by WHERE THIS FILE SITS
// (line 22), so the same engine reads two different histories depending on how it was invoked.
// Measured 2026-08-03: the global install held 40 incidents / 33 classes, the repo canon 23 / 15.
// meta-trend printed LEARNING with 100% gate coverage on one and HOLDING with 50% coverage and a
// 50% regression rate on the other. Every published health number came from the optimistic half.
//
// So the engines read the UNION of both addresses, de-duplicated on (date|class|claimed). The
// repo canon stays the thing that gets committed; the global file stays the cross-project inbox.
// COUNTERPART is the other address than LEDGER, empty when both resolve to the same file.
export const GLOBAL_LEDGER = join(JIDOKA_HOME, 'meta-mistakes.jsonl');
export const REPO_LEDGER = 'docs/audits/meta-mistakes.jsonl';
export const ledgerKey = (r) => `${r?.date || ''}|${r?.class || ''}|${(r?.claimed || '').slice(0, 120)}`;

/** Merge ledger row-sets, keeping first-seen order and dropping exact duplicates. Pure. */
export function mergeLedgers(...rowSets) {
  const seen = new Set(); const out = [];
  for (const rows of rowSets) for (const r of rows || []) {
    const k = ledgerKey(r);
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}

/** Rows present in `from` but missing from `into` — what the canon has not yet absorbed. Pure. */
export function missingFrom(into = [], from = []) {
  const have = new Set(into.map(ledgerKey));
  return from.filter(r => !have.has(ledgerKey(r)));
}

export const loadLedger = (path = LEDGER) => loadJsonl(path, 'meta-lib');

// The reader every ENGINE should use. An explicit META_LEDGER still wins outright, so all the
// synthetic-ledger self-tests keep working unchanged.
export function loadLedgerUnion() {
  if (process.env.META_LEDGER) return loadLedger(process.env.META_LEDGER);
  const primary = loadLedger(LEDGER);
  const other = LEDGER === GLOBAL_LEDGER ? REPO_LEDGER : GLOBAL_LEDGER;
  if (other === LEDGER || !existsSync(other)) return primary;
  return mergeLedgers(primary, loadJsonl(other, 'meta-lib(union)'));
}

// A gate TRIP = the gate fired and blocked something. This is the data that tells
// decay "the risk is still live and this gate is catching it" vs "nothing has
// tried this in months". Recording must never break the gate it instruments.
export const loadTrips = (path = TRIP_LOG) => loadJsonl(path, 'meta-lib(trips)');
export function recordTrip(cls, mechanism) {
  try { appendFileSync(TRIP_LOG, JSON.stringify({ date: todayISO(), class: cls, mechanism }) + '\n'); }
  catch { /* instrumentation is best-effort; a gate must work even if logging fails */ }
}

// META_TODAY lets the whole family be tested across time (aging, quarantine, decay)
// without waiting real days or mutating real dates.
export const todayISO = () => process.env.META_TODAY || new Date().toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const monthOf = iso => iso.slice(0, 7); // YYYY-MM

// normalized-class-key (2026-W32-R7) — the recurrence detector groups incidents by EXACT
// string equality of `class`, and the recurring threshold in meta-audit is exactly 2. Measured
// 2026-08-03 on the merged canon: 45 classes, 37 of them singletons. Two pairs were the same
// defect wearing two names, so the detector could never fire on them:
//
//   gate-block-not-enforced (2026-06-07)   "hard block active, commit refused" but the commit landed
//   gate-claims-block-but-passes (2026-06-10)  the hook does not propagate its exit code
//
//   gate-casing-bypass (2026-05-31)   case-variant path slipped past the protected-path regex
//   gate-bypass (2026-06-06 row)      "protected path via case-variant (lowercase), red-team find 2026-05-31"
//
// DESIGN CHOICE, and it is deliberate: no fuzzy auto-merge. Edit-distance or Jaccard clustering
// would silently fuse classes that merely SOUND alike, and a wrong merge destroys signal in the
// one registry the engine learns from. So:
//   1. a deterministic textual normalization (case, separators, stop-words, token order),
//   2. an explicit alias map, each entry justified by reading BOTH incidents,
//   3. a suggester that PRINTS near-duplicate candidates for a human to confirm, and merges nothing.
// Every merge that does happen is printed, never silent.

const CLASS_STOPWORDS = new Set(['the', 'a', 'an', 'is', 'was', 'be', 'to', 'of', 'in', 'on', 'by', 'and', 'or']);

/** Deterministic textual key: case, separators, stop-words and token order stop mattering. Pure. */
export function normalizeClassKey(cls = '') {
  return String(cls)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .split(/\s+/)
    .filter(w => w && !CLASS_STOPWORDS.has(w))
    .sort()
    .join('-');
}

// Curated aliases: canonical <- duplicate. Each pair was confirmed by reading both incidents,
// not by string similarity. Add here only with that evidence.
export const CLASS_ALIASES = {
  'gate-block-not-enforced': 'gate-claims-block-but-passes',
  'gate-casing-bypass': 'gate-bypass',
};

/** The key a row is actually grouped under. Pure. */
export function classKeyOf(cls = '') {
  const canonical = CLASS_ALIASES[cls] || cls;
  return normalizeClassKey(canonical);
}

/**
 * Near-duplicate candidates: class pairs sharing >= minShared meaningful tokens that are NOT
 * already aliased. Reported, never merged. Pure.
 */
// ── decision-conflict probe (2026-W33-R8, DeMem) ────────────────────────────
// `suggestClassMerges` proposes a merge from SHARED WORDS. Two classes that share two tokens are
// probably the same defect — probably. On the real ledger it proposes exactly one merge today:
// `code-first-in-spec-driven` + `spec-written-after-the-code`. They share "code" and "spec", and
// they are NOT the same lesson: the first says read the controlling spec BEFORE writing, the
// second says make sure a spec COVERS what was written. Merge them and one of the two behaviours
// disappears — whoever reads the surviving lesson learns half of what the ledger knew.
//
// So a merge needs a second opinion: do the two prescribe the SAME ACTION? Deterministic signals
// only, because a judge nobody measured is exactly what this engine keeps regretting:
//   1. different registered mechanisms — two gates means two defects, whatever the words say;
//   2. opposite temporal direction — "before/first" against "after/afterwards";
//   3. opposite polarity — one prescribes doing a thing, the other prescribes not doing it.
const BEFORE_WORDS = /(\bbefore\b|\bfirst\b|\bprior to\b|\bдо\b|сначала|заранее|перед)/i;
const AFTER_WORDS = /(\bafter\b|\bafterwards\b|\bonce\b.{0,20}\bdone\b|после|потом|задним числом|по факту)/i;
const NEGATION = /(\bnever\b|\bdo ?n[o']t\b|\bmust not\b|\bwithout\b|никогда|нельзя|не следует|запрещ)/i;

/**
 * May these two classes be merged into one lesson? Pure.
 * @returns {{conflict:boolean, signals:string[], reason:string}}
 */
export function decisionConflict(a = {}, b = {}, remedies = {}) {
  // The class SLUG carries meaning the incident prose often leaves implicit: on the real pair,
  // "spec-written-after-the-code" states the timing in its name while its incident text does not.
  // Reading only the prose made the probe answer "safe" on the very case it exists for.
  const textA = `${String(a.cls ?? '').replace(/-/g, ' ')} ${String(a.text ?? '')}`;
  const textB = `${String(b.cls ?? '').replace(/-/g, ' ')} ${String(b.text ?? '')}`;
  const signals = [];

  const mechA = remedies[a.cls]?.mechanism ?? null;
  const mechB = remedies[b.cls]?.mechanism ?? null;
  if (mechA && mechB && mechA !== mechB) signals.push(`разные механизмы: ${mechA} против ${mechB}`);

  const dirA = BEFORE_WORDS.test(textA) ? 'before' : AFTER_WORDS.test(textA) ? 'after' : null;
  const dirB = BEFORE_WORDS.test(textB) ? 'before' : AFTER_WORDS.test(textB) ? 'after' : null;
  if (dirA && dirB && dirA !== dirB) signals.push(`противоположный момент действия: «${dirA}» против «${dirB}»`);

  if (NEGATION.test(textA) !== NEGATION.test(textB)) signals.push('один предписывает делать, другой — не делать');

  return {
    conflict: signals.length > 0,
    signals,
    reason: signals.length
      ? `слияние потеряет различие: ${signals.join('; ')}`
      : 'предписываемое действие выглядит одинаковым — слияние безопасно',
  };
}

/** Filter merge suggestions through the conflict probe. Pure. Rejected ones stay VISIBLE. */
export function safeClassMerges(suggestions = [], lessons = {}, remedies = {}) {
  const safe = [], blocked = [];
  for (const s of suggestions) {
    const v = decisionConflict({ cls: s.a, text: lessons[s.a] }, { cls: s.b, text: lessons[s.b] }, remedies);
    (v.conflict ? blocked : safe).push({ ...s, ...v });
  }
  return { safe, blocked };
}

export function suggestClassMerges(classes = [], minShared = 2) {
  const list = [...new Set(classes)].sort();
  const tokens = (c) => new Set(normalizeClassKey(c).split('-').filter(Boolean));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (classKeyOf(list[i]) === classKeyOf(list[j])) continue; // already one class
      const a = tokens(list[i]), b = tokens(list[j]);
      const shared = [...a].filter(t => b.has(t));
      if (shared.length >= minShared) out.push({ a: list[i], b: list[j], shared });
    }
  }
  return out;
}


/**
 * Group rows by class, merging aliased and textually-identical spellings. The returned keys are
 * the most frequent ORIGINAL spelling in each group, so reports stay readable; `mergedPairs` on
 * the returned object records every spelling that was folded in, so no merge is silent.
 */
export function groupByClass(rows) {
  const buckets = new Map(); // normalized key -> { rows, spellings: Map<string, count> }
  for (const r of rows) {
    const k = classKeyOf(r.class);
    if (!buckets.has(k)) buckets.set(k, { rows: [], spellings: new Map() });
    const b = buckets.get(k);
    b.rows.push(r);
    b.spellings.set(r.class, (b.spellings.get(r.class) || 0) + 1);
  }
  const by = {};
  const mergedPairs = [];
  for (const b of buckets.values()) {
    const spellings = [...b.spellings.entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])));
    // prefer the spelling the alias map declares canonical; otherwise the most frequent one
    const aliasTarget = spellings.map(([n]) => CLASS_ALIASES[n]).find(Boolean);
    const display = (aliasTarget && spellings.some(([n]) => n === aliasTarget)) ? aliasTarget : spellings[0][0];
    by[display] = b.rows;
    for (const [name] of spellings) if (name !== display) mergedPairs.push({ folded: name, into: display });
  }
  Object.defineProperty(by, "mergedPairs", { value: mergedPairs, enumerable: false });
  return by;
}

// kept for callers that want the raw, unmerged view (e.g. a migration or an audit of the merge)
export function groupByClassExact(rows) {
  const by = {};
  for (const r of rows) (by[r.class] ??= []).push(r);
  return by;
}

// Incidents strictly AFTER a gate's activation date are recurrences the gate
// failed to stop. Same-day incidents are what provoked the gate (a "before" case).
export function recurrencesAfter(items, since) {
  if (!since) return [];
  return items.filter(it => it.date > since).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Ledger row schema (ledger-pollution write-path gate) ─────────────────────
// A ledger row is a REAL INCIDENT only if it carries all five fields. Telemetry rows
// ({ts,wave,run1,run2}) leaked into the ledger twice on 2026-06-06 and were only caught
// downstream by meta-honesty; this schema rejects them AT WRITE TIME (meta-log) and at
// commit/CI (ledger-schema-gate). One function, shared by both, so the layers can't drift.
// mast-modes-and-entry-kind (2026-W32-R8) — two fields the ledger was missing.
//
// (A) `kind`. A row saying "recurred 1x within one session -> systemic fix: added X" is a
// RECORD OF THE REPAIR, not a second mistake. 9 of 59 rows in the canon are that shape, and
// because nothing distinguished them, meta-audit counted them as recurrences: both classes it
// reported as "recurring, ungated" (reactive-literal-execution, peer-restyle-instead-of-clone)
// were single incidents whose repair note doubled the count. The engine was alarming itself
// with its own fixes.
//
// (B) `mastMode`. Our 43 classes are entirely self-invented, so the ledger cannot know what it
// never thought to look for. MAST is an EXTERNAL, empirically-derived taxonomy of multi-agent
// failure, 14 modes in 3 categories, built from 150+ annotated traces.
//
// Source, read from the paper itself (arxiv 2503.13657, "Why Do Multi-Agent LLM Systems
// Fail?"), NOT from a summary: mode ids, names and per-mode shares are verbatim from the
// taxonomy figure. The CATEGORY shares are derived by summing the modes, because the figure's
// layout puts the category percentages next to the wrong labels: 11.8+1.5+15.7+2.8+12.4 = 44.2
// for System Design Issues, 2.2+6.8+7.4+0.8+1.9+13.2 = 32.3 for Inter-Agent Misalignment,
// 6.2+8.2+9.1 = 23.5 for Task Verification. (A research summary of this paper circulated the
// figures as 42/37/21; that is wrong, and it is why the numbers below were re-derived.)
//
// The field is OPTIONAL on purpose. Labelling all 59 historical rows by hand, alone, would be
// inventing data to fill a column. Rows get a mode only where the mapping is unambiguous from
// the recorded text; coverage is printed rather than assumed.
export const MAST_MODES = [
  { id: 'FM-1.1', name: 'Disobey Task Specification', category: 'System Design Issues', share: 11.8 },
  { id: 'FM-1.2', name: 'Disobey Role Specification', category: 'System Design Issues', share: 1.5 },
  { id: 'FM-1.3', name: 'Step Repetition', category: 'System Design Issues', share: 15.7 },
  { id: 'FM-1.4', name: 'Loss of Conversation History', category: 'System Design Issues', share: 2.8 },
  { id: 'FM-1.5', name: 'Unaware of Termination Conditions', category: 'System Design Issues', share: 12.4 },
  { id: 'FM-2.1', name: 'Conversation Reset', category: 'Inter-Agent Misalignment', share: 2.2 },
  { id: 'FM-2.2', name: 'Fail to Ask for Clarification', category: 'Inter-Agent Misalignment', share: 6.8 },
  { id: 'FM-2.3', name: 'Task Derailment', category: 'Inter-Agent Misalignment', share: 7.4 },
  { id: 'FM-2.4', name: 'Information Withholding', category: 'Inter-Agent Misalignment', share: 0.8 },
  { id: 'FM-2.5', name: "Ignored Other Agent's Input", category: 'Inter-Agent Misalignment', share: 1.9 },
  { id: 'FM-2.6', name: 'Reasoning-Action Mismatch', category: 'Inter-Agent Misalignment', share: 13.2 },
  { id: 'FM-3.1', name: 'Premature Termination', category: 'Task Verification', share: 6.2 },
  { id: 'FM-3.2', name: 'No or Incomplete Verification', category: 'Task Verification', share: 8.2 },
  { id: 'FM-3.3', name: 'Incorrect Verification', category: 'Task Verification', share: 9.1 },
];

export const MAST_IDS = new Set(MAST_MODES.map(m => m.id));
export const MAST_CATEGORY_SHARE = { 'System Design Issues': 44.2, 'Inter-Agent Misalignment': 32.3, 'Task Verification': 23.5 };
export const LEDGER_KINDS = new Set(['incident', 'remediation']);

/** Category of a mode id, or null. Pure. */
export const mastCategoryOf = (id) => (MAST_MODES.find(m => m.id === id) || {}).category || null;

/** Only rows that record an actual mistake. Pure. */
export const incidentsOnly = (rows = []) => rows.filter(r => (r.kind || 'incident') === 'incident');

/**
 * Our distribution over MAST categories vs the published one, computed ONLY over labelled rows.
 * Returns coverage so a reader can see how much of the ledger the comparison actually speaks for.
 * Pure.
 */
export function mastDistribution(rows = []) {
  const incidents = incidentsOnly(rows);
  const labelled = incidents.filter(r => r.mastMode && MAST_IDS.has(r.mastMode));
  const ours = {};
  for (const cat of Object.keys(MAST_CATEGORY_SHARE)) ours[cat] = 0;
  for (const r of labelled) {
    const cat = mastCategoryOf(r.mastMode);
    if (cat) ours[cat] += 1;
  }
  const pct = {};
  for (const [cat, n] of Object.entries(ours)) pct[cat] = labelled.length ? Math.round((n / labelled.length) * 1000) / 10 : 0;
  return {
    incidents: incidents.length,
    labelled: labelled.length,
    coverage: incidents.length ? Math.round((labelled.length / incidents.length) * 100) : 0,
    counts: ours,
    ours: pct,
    published: MAST_CATEGORY_SHARE,
  };
}

export const LEDGER_REQUIRED = ['date', 'class', 'claimed', 'real', 'caught_by'];
export function validateLedgerEntry(e) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return ['row is not an object'];
  const problems = [];
  for (const k of LEDGER_REQUIRED) {
    if (!(k in e)) problems.push(`missing required field "${k}"`);
    else if (typeof e[k] !== 'string' || e[k].trim() === '') problems.push(`field "${k}" must be a non-empty string`);
  }
  if (typeof e.date === 'string' && e.date.trim() !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
    problems.push(`field "date" must be ISO YYYY-MM-DD (got "${e.date}")`);
  }
  // kind: required, so a repair note can never again be counted as a second mistake (W32-R8)
  if (!('kind' in e)) problems.push('missing required field "kind" (incident | remediation)');
  else if (!LEDGER_KINDS.has(e.kind)) problems.push(`field "kind" must be one of ${[...LEDGER_KINDS].join(' | ')} (got "${e.kind}")`);
  // mastMode: ОБЯЗАТЕЛЬНАЯ вторая ось (2026-08-18). Раньше поле было необязательным, и
  // разметка держалась на 28% (20 записей из 72). Пока доля неполная, распределение режимов
  // отказа посчитать нельзя, а без распределения нечем ответить на вопрос «что чинить первым»
  // иначе как впечатлением. Ручной разбор 2026-08-18 (docs/ERROR_ANALYSIS_2026-08.md) довёл
  // разметку до 100% и показал, ради чего это: 65% наших отказов приходится на проверку
  // результата, причём оба верификационных режима перепредставлены вчетверо против источника.
  //
  // ОТСУТСТВИЕ ключа теперь ошибка, а `null` — законный ответ «режим рассмотрен и не подошёл».
  // Разница принципиальная: молчание нельзя отличить от «не думал», а явный null с причиной
  // можно проверить и оспорить. Поэтому при null объяснение ОБЯЗАТЕЛЬНО — иначе null стал бы
  // бесплатной кнопкой «пропустить», и поле вернулось бы к необязательному по факту.
  if (!('mastMode' in e)) {
    problems.push('missing required field "mastMode" (MAST id FM-1.1 … FM-3.3, or null with mastNote)');
  } else if (e.mastMode !== null && !MAST_IDS.has(e.mastMode)) {
    problems.push(`field "mastMode" must be a MAST id (FM-1.1 … FM-3.3) or null (got "${e.mastMode}")`);
  } else if (e.mastMode === null && (typeof e.mastNote !== 'string' || e.mastNote.trim() === '')) {
    problems.push('mastMode is null, so "mastNote" must say in one line why no failure mode fits');
  }
  return problems;
}

// ── guard-on-consolidation (2026-W33-R13) ───────────────────────────────────
// Everything above guards a WRITE: one record arriving, judged against what memory already holds.
// But the digest is not only written to — it is REBUILT. `memory-consolidate.render()` throws the
// whole file away and prints a new one from the ledger, and nothing ever compared the two. A class
// that stops matching a regex, a scoring change that drops a tier, a ledger row that fails to
// parse: any of these deletes a lesson silently, and the next session simply never learns it.
// Losing memory during the act of organising memory is the worst place to have no guard at all.
//
// A lesson may legitimately leave the active tiers — but only by being SUPERSEDED, which keeps it
// in the History tail. Vanishing entirely is never legitimate.
const LESSON_HEADING = /^###\s+([a-z0-9]+(?:-[a-z0-9]+)*)\b/gm;

/** Every class named in a rendered digest, in any tier including History. Pure. */
export function lessonKeys(markdown = '') {
  const out = new Set();
  for (const m of String(markdown).matchAll(LESSON_HEADING)) out.add(m[1]);
  return out;
}

/**
 * Compare the digest BEFORE a consolidation with the one it produced. Pure.
 * `lost` = classes that were there and are now nowhere, not even in History.
 * An empty new digest is never "everything was superseded" — it is a broken rebuild.
 */
export function consolidationVerdict(beforeMd = '', afterMd = '') {
  const before = lessonKeys(beforeMd);
  const after = lessonKeys(afterMd);
  // A class that was RENAMED by an alias merge has not been lost: its incidents live on under the
  // canonical name. Caught on the guard's first live run, where `gate-block-not-enforced` vanished
  // and the guard called it a deletion — it had been merged into `gate-claims-block-but-passes` by
  // W32-R7. A guard that cannot tell a rename from a deletion cries wolf until someone disables it.
  const renamed = (k) => { const t = CLASS_ALIASES[k]; return Boolean(t && after.has(t)); };
  const lost = [...before].filter((k) => !after.has(k) && !renamed(k)).sort();
  const gained = [...after].filter((k) => !before.has(k)).sort();
  if (before.size > 0 && after.size === 0) {
    return { ok: false, lost, gained, reason: `свёртка стёрла ВСЕ уроки (${before.size} → 0): это сломанная пересборка, а не устаревание` };
  }
  return lost.length
    ? { ok: false, lost, gained, reason: `свёртка потеряла ${lost.length} урок(ов) без пометки об устаревании: ${lost.slice(0, 6).join(', ')}` }
    : { ok: true, lost, gained, reason: gained.length ? `уроков не потеряно, добавилось ${gained.length}` : 'уроков не потеряно' };
}
