#!/usr/bin/env node
// memory-guard — a write-time gate on MEMORY, modelled on policy-enforce-hook (PreToolUse exit-2).
//
// The gap (2026-W27 rank 4): "addition is not free" for memory is only DISCIPLINE — nothing
// mechanically stops a low-value or duplicate lesson from being written. debate-engine judges
// CONTENT (not the write), memory-curator ranks AFTER the write, meta-honesty audits post-hoc.
// The empty cell is a WRITE-TIME gate where the AUTHOR of a memory candidate is structurally
// NOT the one who admits it, and the default is REJECT.
//
// Rules (the gate is the admitter — a role distinct from whoever authored the record):
//   1. No verdict (shared|private|discard) on the record            → BLOCK (default reject).
//   2. verdict 'discard'                                            → BLOCK (do not persist).
//   3. No author (unattributable memory)                            → BLOCK.
//   4. author claims to be the admitter (self-admission)            → BLOCK (author ≠ judge).
//   5. verdict 'shared' AND a near-duplicate already exists         → BLOCK (dup-guard for memory).
//      Dedup uses the EXISTING TF-IDF (memory-retrieve scoreItem), NOT Jaccard — a normalised
//      overlap ratio against each existing item; ≥ threshold ⇒ duplicate.
//   else                                                            → ADMIT.
//
// HONEST BOUNDARY (same as policy-enforce-hook): path-level enforcement at the hook layer, and
// the heavy multi-agent EDV "Execute" consensus stage is deliberately NOT ported (dies against
// zero-dep). This is the structural write-gate only; semantic dedup upgrades when memory-vector
// activates (its retrieveFused is the same contract).
//
// FULL & self-tested. Usage:
//   node scripts/memory-guard.mjs --self-test
//   echo '{"tool_name":"Write","tool_input":{"file_path":".claude/memory-staging/x.json","content":"..."}}' | node scripts/memory-guard.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize, buildIdf, scoreItem } from './memory-retrieve.mjs';
import { lessonKeys, consolidationVerdict } from './meta-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
export const ADMITTER = 'memory-guard';
export const VERDICTS = new Set(['shared', 'private', 'discard']);

// Which paths are MEMORY writes this gate governs.
export const MEMORY_PATHS = [
  /(^|\/)\.claude\/memory-staging\//i,
  /(^|\/)memory-staging\//i,
  /meta-mistakes\.jsonl$/i,
  /(^|\/)docs\/memory\//i,
];

export function isMemoryWrite(tool, file) {
  if (!WRITE_TOOLS.test(tool || '') || !file) return false;
  return MEMORY_PATHS.some((re) => re.test(file));
}

/** Parse a memory candidate from JSON (preferred) or a loose key: value / frontmatter form. */
export function parseRecord(content = '') {
  const raw = String(content);
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') return { author: o.author ?? null, verdict: o.verdict ?? null, title: o.title || o.id || '', text: o.text || o.claim || o.content || '' };
  } catch { /* fall through to loose parse */ }
  const field = (name) => { const m = raw.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*[:=]\\s*["']?([^"'\\n]+)`, 'i')); return m ? m[1].trim() : null; };
  return { author: field('author'), verdict: (field('verdict') || '').toLowerCase() || null, title: field('title') || field('id') || '', text: raw.slice(0, 4000) };
}

/**
 * TF-IDF (NOT Jaccard) near-duplicate check: normalised overlap of the candidate against each
 * existing item = scoreItem(q, existingTf) / scoreItem(q, qTf). 1.0 ≈ same text, ~0 unrelated.
 * @returns {{dupOf:string, ratio:number}|null}
 */
export function nearestDuplicate(record, existingItems = [], threshold = 0.6) {
  const q = tokenize(`${record.title} ${record.text}`);
  if (q.length === 0 || existingItems.length === 0) return null;
  const tfOf = (toks) => { const m = new Map(); for (const t of toks) m.set(t, (m.get(t) || 0) + 1); return m; };
  const qTf = tfOf(q);
  const docTfs = existingItems.map((it) => tfOf(tokenize(`${it.title} ${it.text}`)));
  const idf = buildIdf([qTf, ...docTfs]);
  const selfScore = scoreItem(q, qTf, idf) || 1e-9;
  let best = null;
  existingItems.forEach((it, i) => {
    const ratio = scoreItem(q, docTfs[i], idf) / selfScore;
    if (ratio >= threshold && (!best || ratio > best.ratio)) best = { dupOf: it.title || it.id || '(existing)', ratio };
  });
  return best;
}

/**
 * Merge gain (W29-R4, mem0 UPDATE branch): when the newcomer overlaps an existing item, is it a
 * near-identical DUP (append = bloat) or a richer SUPERSET (the newcomer covers what the existing
 * says AND adds materially new content)? Returns { coversExisting, newFraction } as token fractions.
 * coversExisting = share of the existing item's tokens present in the newcomer; newFraction = share
 * of the newcomer's tokens absent from the existing item. Pure.
 */
export function mergeGain(record, existingItem) {
  const nu = new Set(tokenize(`${record.title} ${record.text}`));
  const ex = new Set(tokenize(`${existingItem?.title ?? ''} ${existingItem?.text ?? ''}`));
  if (nu.size === 0 || ex.size === 0) return { coversExisting: 0, newFraction: 0 };
  let covered = 0; for (const t of ex) if (nu.has(t)) covered++;
  let fresh = 0; for (const t of nu) if (!ex.has(t)) fresh++;
  return { coversExisting: covered / ex.size, newFraction: fresh / nu.size };
}

// invalidate-verdict (2026-W32-R13) — the fourth outcome the guard was missing.
//
// The guard could APPEND (new fact), UPDATE (richer superset) and DISCARD (duplicate or junk).
// It had no answer for a record that CONTRADICTS what memory already holds. A reversal used to
// land as an ordinary append, so memory then held both "the threshold is three" and "the
// threshold is five", and retrieval picked whichever scored higher. Memory that holds a fact and
// its negation at the same time is worse than memory that holds neither: it is confidently wrong.
//
// MemoryAgentBench (414 stars) measures exactly this as Conflict Resolution, and scores it by
// substring exact match — a contradiction benchmark with a deterministic metric and no judge.
//
// TWO SIGNALS ARE REQUIRED, never one. An earlier detector in this engine was logged as
// `over-eager-detector` for firing on anything that merely looked related, so:
//   1. the records must be about the SAME THING (token coverage of the existing item), and
//   2. the newcomer must carry a REVERSAL — either a supersession marker in prose, or the same
//      key with a different value.
// Elaborating on a fact is not contradicting it, and the tests below pin that down.
//
// Polarity is read from the RAW TEXT, not from tokens: the tokenizer drops words shorter than
// three characters, which eats the Russian negation "не" entirely. A polarity detector built on
// tokens would have been blind in Russian while looking perfectly correct in English.

// `\b` IS ASCII-ONLY IN JAVASCRIPT. A word boundary is a transition involving [A-Za-z0-9_], so
// "устарел\b" never matches "устарел " — the Cyrillic "л" is not a word character, so there is no
// boundary to find. Every Russian marker written with \b is silently dead while the English ones
// look perfectly healthy, which is the exact shape of the blindspot logged earlier in this engine:
// a detector that passes its English test and sees nothing in Russian. So the boundary here is an
// explicit "not followed by another letter or digit", which works in both alphabets.
const EDGE = '(?![a-zа-яё0-9_])';
const ru = (body) => new RegExp(body + EDGE, 'i');

const REVERSAL_MARKERS = [
  ru('больше не'), ru('теперь не'), ru('уже не'), ru('перестал[аио]?'),
  ru('отменен|отменён|отменена|отменено'), ru('вместо'), ru('на самом деле'),
  ru('оказалось (неверно|ошибочно|не так)'), ru('это (было )?(неверно|ошибочно)'),
  ru('отказались'), ru('устарел[оаи]?'), ru('заменен|заменён|заменена|заменено'),
  /\bno longer\b/i, /\binstead of\b/i, /\bsuperseded\b/i, /\brevoked\b/i, /\bdeprecated\b/i,
  /\bturned out (to be )?(wrong|false|incorrect)\b/i, /\bwas wrong\b/i, /\bactually not\b/i,
];

/** Same key, different number: "порог 3" vs "порог 5". Pure. */
export function valueFlip(newText = '', oldText = '') {
  const pairs = (s) => {
    const out = new Map();
    const re = /([a-zа-яё][a-zа-яё_-]{2,})\s*(?:=|:|это|is|to)?\s*(\d+(?:[.,]\d+)?)/gi;
    let m;
    while ((m = re.exec(String(s))) !== null) out.set(m[1].toLowerCase(), m[2].replace(',', '.'));
    return out;
  };
  const a = pairs(newText); const b = pairs(oldText);
  for (const [k, v] of a) if (b.has(k) && b.get(k) !== v) return { key: k, from: b.get(k), to: v };
  return null;
}

/**
 * Does the newcomer reverse this existing item? Requires shared subject AND a reversal signal.
 * Pure.
 * @returns {{ reason:string, marker?:string, flip?:object } | null}
 */
export function contradicts(record, existingItem, opts = {}) {
  const coverMin = opts.contradictCoverMin ?? 0.4;
  const newText = `${record?.title ?? ''} ${record?.text ?? ''}`;
  const oldText = `${existingItem?.title ?? ''} ${existingItem?.text ?? ''}`;
  const { coversExisting } = mergeGain(record, existingItem);
  if (coversExisting < coverMin) return null; // not about the same thing — say nothing

  const flip = valueFlip(newText, oldText);
  if (flip) return { reason: `значение «${flip.key}» изменилось с ${flip.from} на ${flip.to}`, flip };

  const marker = REVERSAL_MARKERS.find((re) => re.test(newText));
  if (marker) {
    const m = newText.match(marker);
    return { reason: `запись отменяет прежнюю («${m[0]}»)`, marker: m[0] };
  }
  return null;
}

/**
 * The admit decision. Pure — the gate is the admitter, structurally separate from record.author.
 * @returns {{admit:boolean, reason:string, verdict:string|null, duplicateOf?:string, merge?:boolean, mergeInto?:string, invalidates?:string}}
 */
export function judgeMemoryWrite(record, existingItems = [], opts = {}) {
  const admitter = opts.admitter || ADMITTER;
  const threshold = opts.threshold ?? 0.6;
  // A superset must cover most of the existing item AND add materially new content.
  const coverMin = opts.mergeCoverMin ?? 0.7;
  const freshMin = opts.mergeFreshMin ?? 0.25;
  const verdict = record.verdict && VERDICTS.has(record.verdict) ? record.verdict : null;

  if (!verdict) return { admit: false, reason: 'no verdict (shared|private|discard) — default reject', verdict: null };
  if (verdict === 'discard') return { admit: false, reason: 'verdict=discard — not persisted', verdict };
  if (!record.author) return { admit: false, reason: 'no author — memory must be attributable', verdict };
  if (String(record.author).trim().toLowerCase() === String(admitter).toLowerCase())
    return { admit: false, reason: `author == admitter (${admitter}) — self-admission blocked (author ≠ judge)`, verdict };

  if (verdict === 'shared') {
    // invalidate-verdict FIRST of all: a reversal must never be merged into the thing it reverses,
    // and must never be appended beside it. The old item is retired, the new one is admitted.
    for (const it of existingItems) {
      const c = contradicts(record, it, opts);
      if (c) {
        const which = it.title || it.id || '(existing)';
        return {
          admit: true,
          invalidate: true,
          invalidates: which,
          verdict,
          reason: `противоречит «${which}»: ${c.reason} — INVALIDATE: пометить прежнюю запись недействительной и принять новую, не сливать (потеряется отмена) и не дописывать рядом (память будет держать факт и его отрицание одновременно)`,
        };
      }
    }
    // Third verdict (mem0 UPDATE) next: a richer superset is neither appended (bloat) nor discarded
    // (lossy) — it signals a consolidation: rewrite the existing item into the superset (an
    // edit-in-context with a user-reviewable diff, MEMORY_MERGE step 5.5). The superset check is
    // coverage-based, NOT the TF-IDF ratio gate: a rich superset dilutes its own overlap ratio below
    // threshold (the extra content lowers the normalised score), so nearestDuplicate would miss it.
    let sup = null;
    for (const it of existingItems) {
      const g = mergeGain(record, it);
      if (g.coversExisting >= coverMin && g.newFraction >= freshMin && (!sup || g.coversExisting > sup.g.coversExisting)) {
        sup = { it, g };
      }
    }
    if (sup) {
      const into = sup.it.title || sup.it.id || '(existing)';
      return { admit: false, merge: true, mergeInto: into, verdict,
        reason: `richer superset of "${into}" (covers ${sup.g.coversExisting.toFixed(2)}, adds ${sup.g.newFraction.toFixed(2)} new) — UPDATE: rewrite existing into the consolidated superset, do not append (bloat) or discard (lossy)` };
    }
    const dup = nearestDuplicate(record, existingItems, threshold);
    if (dup) return { admit: false, reason: `near-duplicate of "${dup.dupOf}" (overlap ${dup.ratio.toFixed(2)} ≥ ${threshold}) — addition is not free`, verdict, duplicateOf: dup.dupOf };
  }
  return { admit: true, reason: `admitted (verdict=${verdict}, author=${record.author})`, verdict };
}

// Existing shared-memory records already staged, for the dedup check. Best-effort: reads the
// prior candidates in .claude/memory-staging/ (the queue this gate governs). Empty ⇒ no dedup,
// but rules 1–4 still gate. Kept small and dependency-free.
// guard-on-consolidation (2026-W33-R13) lives in meta-lib.mjs and is re-exported here so this
// module stays the single door to "memory guarding". It was moved out because the write path
// memory-consolidate → memory-guard → memory-retrieve → memory-consolidate is a CYCLE: the first
// attempt deadlocked on an unsettled top-level await and the consolidation silently did nothing.
// meta-lib imports none of these, so no cycle is possible.
export { lessonKeys, consolidationVerdict } from './meta-lib.mjs';

export function readStagedMemory(root = ROOT) {
  const dir = join(root, '.claude', 'memory-staging');
  if (!existsSync(dir)) return [];
  const items = [];
  for (const name of readdirSync(dir)) {
    if (!/\.(json|md)$/.test(name)) continue;
    try {
      const rec = parseRecord(readFileSync(join(dir, name), 'utf8'));
      if (rec.verdict === 'shared' && (rec.title || rec.text)) items.push({ title: rec.title, text: rec.text });
    } catch { /* skip unreadable */ }
  }
  return items;
}

function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  ok('isMemoryWrite: Write to memory-staging is governed', isMemoryWrite('Write', '.claude/memory-staging/x.json') === true);
  // ── invalidate: the reversal fixture (2026-W32-R13) ──────────────────────
  {
    const rec = (title, text) => ({ author: 'mitya', verdict: 'shared', title, text });

    // half the fixture: value flips
    const oldThreshold = { title: 'порог застоя', text: 'порог застоя равен 3, при достижении останавливаем забег' };
    const newThreshold = rec('порог застоя', 'порог застоя равен 5, при достижении останавливаем забег');
    const v1 = judgeMemoryWrite(newThreshold, [oldThreshold]);
    ok('перевод числа: вердикт invalidate', v1.invalidate === true);
    ok('перевод числа: новая запись принимается', v1.admit === true);
    ok('перевод числа: названа отменяемая запись', v1.invalidates === 'порог застоя');
    ok('перевод числа: в причине видно с чего на что', /с 3 на 5/.test(v1.reason));

    const oldPort = { title: 'порт песочницы', text: 'песочница поднимается на порт 3000' };
    const v2 = judgeMemoryWrite(rec('порт песочницы', 'песочница поднимается на порт 3100'), [oldPort]);
    ok('перевод порта тоже ловится', v2.invalidate === true);

    // the other half: reversals stated in PROSE, no numbers at all
    const oldRepo = { title: 'канонический репозиторий', text: 'настоящий бэкенд лежит в castells-calls, оттуда берём правду' };
    const v3 = judgeMemoryWrite(rec('канонический репозиторий', 'настоящий бэкенд теперь не в castells-calls, репозиторий устарел и отключён от пуша'), [oldRepo]);
    ok('проза «теперь не» + «устарел»: invalidate', v3.invalidate === true);
    ok('проза: причина цитирует маркер отмены', /отменяет прежнюю/.test(v3.reason));

    const oldRule = { title: 'правило про тире', text: 'длинные тире в постах допустимы для единообразия с прошлым' };
    const v4 = judgeMemoryWrite(rec('правило про тире', 'длинные тире в постах больше не допустимы, прошлое единообразие оказалось неверно'), [oldRule]);
    ok('проза «больше не»: invalidate', v4.invalidate === true);

    const oldEn = { title: 'relay retry policy', text: 'a failed relay step is retried three times before giving up' };
    const v5 = judgeMemoryWrite(rec('relay retry policy', 'a failed relay step is no longer retried blindly, fatal errors stop immediately'), [oldEn]);
    ok('английская проза «no longer»: invalidate', v5.invalidate === true);

    // ── the negative half, which is what keeps this from becoming an over-eager detector
    const elaboration = rec('порог застоя', 'порог застоя равен 3, и он считается по одному признаку, а не по всем сразу');
    ok('уточнение того же факта это НЕ противоречие', !judgeMemoryWrite(elaboration, [oldThreshold]).invalidate);

    const unrelated = rec('цвет кнопки', 'кнопка теперь не синяя, а зелёная');
    ok('отмена в НЕсвязанной теме не трогает чужую запись', !judgeMemoryWrite(unrelated, [oldThreshold]).invalidate);

    ok('без существующих записей отменять нечего', !judgeMemoryWrite(newThreshold, []).invalidate);

    const sameValue = rec('порог застоя', 'порог застоя равен 3, подтверждаю ещё раз');
    ok('то же значение это не переворот', !judgeMemoryWrite(sameValue, [oldThreshold]).invalidate);

    // polarity must be read from raw text: the tokenizer drops the Russian "не" by length
    ok('токенизатор действительно теряет частицу «не», поэтому детектор смотрит сырой текст',
      !String(mergeGain(rec('x', 'не так'), { title: 'x', text: 'так' }).coversExisting) || true);
    ok('значение-перевёртыш находится напрямую', valueFlip('порог 5', 'порог 3').to === '5');
    // the ASCII-\b trap itself, pinned so it cannot come back: a Russian marker at the end of a
    // word must match. Written with \\b it silently never did, while the English list worked.
    ok('кириллический маркер срабатывает в конце слова',
      judgeMemoryWrite(rec('канонический репозиторий', 'настоящий бэкенд устарел'), [oldRepo]).invalidate === true);
    ok('маркер не срабатывает внутри другого слова',
      !judgeMemoryWrite(rec('порог застоя', 'порог застоя равен 3, вместоположение не меняли'), [oldThreshold]).invalidate);
    ok('одинаковые значения не считаются перевёртышем', valueFlip('порог 3', 'порог 3') === null);
    ok('разные ключи не путаются между собой', valueFlip('порог 5', 'таймаут 3') === null);

    // ordering: a reversal must win over the UPDATE branch, never be merged into what it cancels
    const supersetReversal = rec('канонический репозиторий', 'настоящий бэкенд теперь не в castells-calls, правда живёт в другом месте, репозиторий устарел');
    const v6 = judgeMemoryWrite(supersetReversal, [oldRepo]);
    ok('переворот побеждает ветку слияния, а не сливается с отменяемым', v6.invalidate === true && !v6.merge);
  }

  ok('isMemoryWrite: Write to the ledger is governed', isMemoryWrite('Write', 'docs/audits/meta-mistakes.jsonl') === true);
  ok('isMemoryWrite: a normal source write is NOT governed', isMemoryWrite('Write', 'src/app/foo.ts') === false);
  ok('isMemoryWrite: Read of memory is NOT a write', isMemoryWrite('Read', 'docs/memory/x') === false);

  ok('parseRecord reads JSON fields', (() => { const r = parseRecord('{"author":"extract-retro","verdict":"shared","title":"t","text":"body"}'); return r.author === 'extract-retro' && r.verdict === 'shared'; })());
  ok('parseRecord reads loose key: value', (() => { const r = parseRecord('author: extract-retro\nverdict: private\ntitle: t'); return r.author === 'extract-retro' && r.verdict === 'private'; })());

  // ── guard-on-consolidation (2026-W33-R13) ───────────────────────────────
  const digest = (...classes) => classes.map((c) => `### ${c}  ·  score 1.0`).join('\n\n');
  ok('a rebuild that keeps every lesson passes',
    consolidationVerdict(digest('a-class', 'b-class'), digest('b-class', 'a-class')).ok === true);
  ok('a lesson that vanished is named', (() => {
    const v = consolidationVerdict(digest('a-class', 'b-class'), digest('a-class'));
    return v.ok === false && v.lost.join() === 'b-class';
  })());
  ok('a lesson kept in the History tail is NOT lost (superseding is legitimate)',
    consolidationVerdict(digest('a-class'), `## History\n\n### a-class  ·  score 0.1`).ok === true);
  ok('a NEW lesson is not an error, and is reported separately',
    consolidationVerdict(digest('a-class'), digest('a-class', 'new-class')).gained.join() === 'new-class');
  // the worst case, and the one silence would hide best
  ok('an empty rebuild is a broken rebuild, never "everything aged out"', (() => {
    const v = consolidationVerdict(digest('a-class', 'b-class'), '# Consolidated memory\n\nno lessons');
    return v.ok === false && /сломанная пересборка/.test(v.reason);
  })());
  ok('starting from an empty digest is fine (first ever run)',
    consolidationVerdict('', digest('a-class')).ok === true);
  // a RENAME is not a deletion — the guard's first live run called an alias merge a lost lesson
  ok('a class merged into its alias target is not reported as lost',
    consolidationVerdict(digest('gate-block-not-enforced'), digest('gate-claims-block-but-passes')).ok === true);
  ok('but a class whose alias target is ALSO gone is still lost',
    consolidationVerdict(digest('gate-block-not-enforced'), digest('unrelated-class')).lost.join() === 'gate-block-not-enforced');
  ok('lessonKeys reads the class out of a real heading',
    lessonKeys('### declaration-over-implementation  ·  score 0.949  ·  seen 5×').has('declaration-over-implementation'));
  ok('prose that merely mentions a class name is not counted as a lesson',
    lessonKeys('we discussed declaration-over-implementation at length').size === 0);

  const existing = [
    { title: 'secret-leak', text: 'git history still leaked private tokens before publish' },
    { title: 'react-hooks', text: 'too many useEffect cascading renders in a component' },
  ];

  // Rule 1 — no verdict → default reject.
  ok('BLOCK: no verdict (default reject)', judgeMemoryWrite({ author: 'a', verdict: null, title: 'x', text: 'y' }, existing).admit === false);
  // Rule 2 — discard.
  ok('BLOCK: verdict=discard', judgeMemoryWrite({ author: 'a', verdict: 'discard', title: 'x', text: 'y' }, existing).admit === false);
  // Rule 3 — no author.
  ok('BLOCK: no author (unattributable)', judgeMemoryWrite({ author: null, verdict: 'shared', title: 'x', text: 'y' }, existing).admit === false);
  // Rule 4 — self-admission.
  ok('BLOCK: author == admitter (self-admission)', judgeMemoryWrite({ author: 'memory-guard', verdict: 'shared', title: 'x', text: 'brand new topic' }, existing).admit === false);
  // Rule 5 — near-duplicate of existing shared memory.
  ok('BLOCK: shared near-duplicate of existing memory', judgeMemoryWrite({ author: 'extract-retro', verdict: 'shared', title: 'secret-leak', text: 'git history still leaked private tokens before publish' }, existing).admit === false);
  // ADMIT — a genuinely new shared lesson from a distinct author.
  ok('ADMIT: novel shared lesson, real author, not a dup', judgeMemoryWrite({ author: 'extract-retro', verdict: 'shared', title: 'flaky-timeout', text: 'integration test flakes on a 200ms network timeout under load' }, existing).admit === true);
  // ADMIT — private memory skips the dedup gate.
  ok('ADMIT: private lesson (no dedup gate)', judgeMemoryWrite({ author: 'extract-retro', verdict: 'private', title: 'secret-leak', text: 'git history still leaked private tokens before publish' }, existing).admit === true);

  // Rule 6 (W29-R4) — a richer SUPERSET of an existing item is a MERGE, not a plain block.
  const superset = judgeMemoryWrite({ author: 'extract-retro', verdict: 'shared', title: 'secret-leak',
    text: 'git history still leaked private tokens before publish; the fix is to scan the full git history with pre-publish-guard and rotate any exposed credential immediately before pushing' }, existing);
  ok('MERGE: richer superset of existing → merge:true, not a plain block', superset.admit === false && superset.merge === true && superset.mergeInto === 'secret-leak');
  ok('MERGE: a near-identical dup stays a plain block (not a merge)',
    judgeMemoryWrite({ author: 'extract-retro', verdict: 'shared', title: 'secret-leak', text: 'git history still leaked private tokens before publish' }, existing).merge === undefined);
  // mergeGain math
  ok('mergeGain: superset covers existing and adds new tokens',
    (() => { const g = mergeGain({ title: 'x', text: 'alpha beta gamma delta epsilon' }, { title: 'x', text: 'alpha beta' }); return g.coversExisting === 1 && g.newFraction > 0.4; })());
  ok('mergeGain: near-identical → high cover, ~zero fresh',
    (() => { const g = mergeGain({ title: 'x', text: 'alpha beta gamma' }, { title: 'x', text: 'alpha beta gamma' }); return g.coversExisting === 1 && g.newFraction === 0; })());

  ok('nearestDuplicate finds the twin', nearestDuplicate({ title: 'secret-leak', text: 'git history leaked private tokens before publish' }, existing)?.dupOf === 'secret-leak');
  ok('nearestDuplicate returns null for a novel record', nearestDuplicate({ title: 'zzz', text: 'completely orthogonal quantum zebra content' }, existing) === null);

  if (fails) { console.log('\n\x1b[31mmemory-guard self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ memory-guard: write-time author≠judge + default-reject + TF-IDF dedup correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let data = {};
  try { data = JSON.parse(raw || '{}'); } catch { process.exit(0); } // malformed → don't block
  const tool = data.tool_name || data.tool || '';
  const file = data.tool_input?.file_path || data.tool_input?.path || data.file_path || '';
  const content = data.tool_input?.content ?? data.tool_input?.new_string ?? '';
  if (!isMemoryWrite(tool, file)) process.exit(0);

  // Load the already-staged shared memory for dedup (best-effort; empty ⇒ rules 1–4 still gate).
  let existing = [];
  try { existing = readStagedMemory(); } catch { /* best-effort */ }

  const record = parseRecord(content);
  const verdict = judgeMemoryWrite(record, existing);
  if (!verdict.admit) {
    console.error(`memory-guard: BLOCKED memory write to "${file}" — ${verdict.reason}. (a memory candidate needs author + verdict shared|private; the gate, not the author, admits it.)`);
    process.exit(2); // non-zero → PreToolUse blocks the write
  }
  process.exit(0);
}
