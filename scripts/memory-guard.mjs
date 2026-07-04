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
 * The admit decision. Pure — the gate is the admitter, structurally separate from record.author.
 * @returns {{admit:boolean, reason:string, verdict:string|null, duplicateOf?:string}}
 */
export function judgeMemoryWrite(record, existingItems = [], opts = {}) {
  const admitter = opts.admitter || ADMITTER;
  const threshold = opts.threshold ?? 0.6;
  const verdict = record.verdict && VERDICTS.has(record.verdict) ? record.verdict : null;

  if (!verdict) return { admit: false, reason: 'no verdict (shared|private|discard) — default reject', verdict: null };
  if (verdict === 'discard') return { admit: false, reason: 'verdict=discard — not persisted', verdict };
  if (!record.author) return { admit: false, reason: 'no author — memory must be attributable', verdict };
  if (String(record.author).trim().toLowerCase() === String(admitter).toLowerCase())
    return { admit: false, reason: `author == admitter (${admitter}) — self-admission blocked (author ≠ judge)`, verdict };

  if (verdict === 'shared') {
    const dup = nearestDuplicate(record, existingItems, threshold);
    if (dup) return { admit: false, reason: `near-duplicate of "${dup.dupOf}" (overlap ${dup.ratio.toFixed(2)} ≥ ${threshold}) — addition is not free`, verdict, duplicateOf: dup.dupOf };
  }
  return { admit: true, reason: `admitted (verdict=${verdict}, author=${record.author})`, verdict };
}

// Existing shared-memory records already staged, for the dedup check. Best-effort: reads the
// prior candidates in .claude/memory-staging/ (the queue this gate governs). Empty ⇒ no dedup,
// but rules 1–4 still gate. Kept small and dependency-free.
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
  ok('isMemoryWrite: Write to the ledger is governed', isMemoryWrite('Write', 'docs/audits/meta-mistakes.jsonl') === true);
  ok('isMemoryWrite: a normal source write is NOT governed', isMemoryWrite('Write', 'src/app/foo.ts') === false);
  ok('isMemoryWrite: Read of memory is NOT a write', isMemoryWrite('Read', 'docs/memory/x') === false);

  ok('parseRecord reads JSON fields', (() => { const r = parseRecord('{"author":"extract-retro","verdict":"shared","title":"t","text":"body"}'); return r.author === 'extract-retro' && r.verdict === 'shared'; })());
  ok('parseRecord reads loose key: value', (() => { const r = parseRecord('author: extract-retro\nverdict: private\ntitle: t'); return r.author === 'extract-retro' && r.verdict === 'private'; })());

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
