#!/usr/bin/env node
/**
 * clarify-gate — the forcing function that makes clarify-engine non-voluntary.
 *
 * Mirrors spec-first-gate.mjs exactly (same enforcement strength the project
 * already trusts): when staged changes create or edit a controlling spec under
 * docs/specs/ (a *_MASTER_SPEC.md), require that the business-question coverage
 * for that feature is COMPLETE — every category Clear or explicitly
 * Deferred-with-reason — and was recorded recently (docs/audits/clarify-runs.jsonl,
 * written by clarify-engine.mjs).
 *
 * Without this gate, clarify-engine would be dormant (an agent could skip it and
 * write the spec anyway). With it, the spec phase cannot close on an
 * under-elicited input — the exact gap the research flagged.
 *
 * Usage:
 *   node scripts/clarify-gate.mjs --staged              # gate a commit (WARN)
 *   node scripts/clarify-gate.mjs --staged --block      # exit 1 instead of WARN
 *   node scripts/clarify-gate.mjs --staged --since 48h  # freshness window (default 24h)
 *   node scripts/clarify-gate.mjs --self-test
 *
 * Honest limit: like spec-first-gate, this verifies the coverage STATE is
 * complete and fresh, not that the answers are good. Forcing function, not proof.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { screenQuestions } from './clarify-question-quality.mjs';

/** Pull question lines (containing '?') from a spec's ## Clarifications section. */
export function questionLines(md = '') {
  const lines = String(md).split('\n');
  const start = lines.findIndex((l) => /^#{1,4}\s+clarification/i.test(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,4}\s/.test(lines[i])) break; // next heading ends the section
    const t = lines[i].replace(/^[-*>\s]+/, '').trim();
    if (t.includes('?')) out.push(t);
  }
  return out;
}

const slug = (f) => String(f).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');

/** docs/specs/wave-foo_MASTER_SPEC.md → "wave-foo". */
export function featureFromSpecPath(file) {
  const base = file.split('/').pop() || file;
  return slug(base.replace(/\.md$/i, '').replace(/_?master_?spec$/i, '').replace(/[_-]+$/g, ''));
}

export function parseSince(s) {
  const m = /^(\d+)([hmd])$/.exec(String(s).trim());
  if (!m) return 24 * 3600_000;
  return Number(m[1]) * { m: 60_000, h: 3600_000, d: 86_400_000 }[m[2]];
}

/** A spec path is a controlling master spec that requires clarification. */
export function isMasterSpec(file) {
  return /^docs\/specs\/.*_MASTER_SPEC\.md$/i.test(file);
}

export function coverageComplete(coveragePath, readFn = readFileSync, existsFn = existsSync) {
  if (!existsFn(coveragePath)) return { complete: false, reason: 'no coverage file' };
  let cov;
  try { cov = JSON.parse(readFn(coveragePath, 'utf8')); } catch { return { complete: false, reason: 'unreadable coverage' }; }
  const cats = cov.categories || {};
  const keys = Object.keys(cats);
  if (keys.length === 0) return { complete: false, reason: 'empty coverage' };
  const complete = keys.every((k) => cats[k].state === 'clear' || (cats[k].state === 'deferred' && cats[k].reason));
  return { complete, reason: complete ? 'ok' : 'categories still missing/partial' };
}

// ── JTBD-frame check (W29-R5, idea from JTBD-Mapper — deterministic slice only, NO LLM judge) ──
// The 'problem' answer should frame a JOB-TO-BE-DONE as an outcome — canonically "When [situation],
// I want [motivation], so that [outcome]" — not name a solution ("нужна кнопка экспорта"). A job
// framed as situation→outcome converts cleanly into an EARS acceptance criterion; a solution noun
// does not. jtbdFrame reports which of the three slots the answer is missing. Language-tolerant
// (RU + EN). Advisory only (this gate is a forcing function, not proof) — same posture as the
// clarify-question-quality WARN. Partial mechanical antidote to reactive-literal-execution.
// NOTE: no \b word boundaries — JS \b is ASCII-only and does NOT fire around Cyrillic letters, so
// \bхочу would never match. The markers are distinctive enough that plain substring (case-insensitive)
// matching is safe for an advisory check.
const JTBD_SLOTS = {
  situation: /(когда|в ситуац|в случае|в момент|when |whenever)/i,
  motivation: /(хочу|хочет|хотел|нужно|нужен|нужна|need|want|so i can)/i,
  outcome: /(чтобы|для того|ради того|so that|so-that|in order to|в результате)/i,
};
export function jtbdFrame(text = '') {
  const t = String(text);
  const missing = Object.keys(JTBD_SLOTS).filter((slot) => !JTBD_SLOTS[slot].test(t));
  return { framed: missing.length === 0, missing };
}

// Warnings for a coverage object: the high-impact 'problem' answer must carry the JTBD frame.
export function jtbdCoverage(cov) {
  const cats = cov?.categories || {};
  const warns = [];
  const problem = cats.problem;
  if (problem && (problem.state === 'clear' || problem.state === 'partial') && problem.answer) {
    const f = jtbdFrame(problem.answer);
    if (!f.framed) warns.push(`problem answer is not framed as a job-to-be-done (missing: ${f.missing.join(', ')}) — restate as "When <situation>, I want <motivation>, so that <outcome>"`);
  }
  return warns;
}

function recentTrace(feature, windowMs) {
  const LOG = 'docs/audits/clarify-runs.jsonl';
  if (!existsSync(LOG)) return false;
  const now = Date.now();
  for (const line of readFileSync(LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (slug(rec.feature) !== feature) continue;
      const t = Date.parse(rec.ts);
      if (Number.isFinite(t) && now - t <= windowMs) return true;
    } catch { /* skip */ }
  }
  return false;
}

function stagedFiles() {
  try {
    return execSync('git diff --cached --name-only', { encoding: 'utf8' }).split('\n').map((f) => f.trim()).filter(Boolean);
  } catch { return []; }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const staged = args.includes('--staged');
  const block = args.includes('--block');
  const since = args.find((_, i) => args[i - 1] === '--since') ?? '24h';
  if (!staged) { console.log('clarify-gate: pass --staged to gate a commit. (dry mode, no-op)'); process.exit(0); }

  const specs = stagedFiles().filter(isMasterSpec);
  if (specs.length === 0) { console.log('clarify-gate: no master-spec changes staged — gate N/A.'); process.exit(0); }

  const windowMs = parseSince(since);
  const failures = [];
  for (const spec of specs) {
    const feature = featureFromSpecPath(spec);
    const covPath = `docs/audits/clarify/${feature}.json`;
    const cov = coverageComplete(covPath);
    const fresh = recentTrace(feature, windowMs);
    if (!cov.complete || !fresh) failures.push({ spec, feature, why: !cov.complete ? cov.reason : `no clarify run within ${since}` });

    // JTBD-frame WARN (2026-W29-R5): the job-to-be-done answer should be framed as an outcome, not a
    // solution. Advisory — never blocks, like the question-quality WARN above.
    try {
      const covObj = JSON.parse(readFileSync(covPath, 'utf8'));
      for (const w of jtbdCoverage(covObj)) console.warn(`  ⚠ jtbd-frame ${feature}: ${w}`);
    } catch { /* best-effort — jtbd-frame is advisory */ }

    // Question-quality WARN (2026-W27): screen the spec's own recorded clarification questions
    // for interviewer-errors (leading / double-barrelled / hypothetical / …). Never blocks.
    try {
      const bad = screenQuestions(questionLines(readFileSync(spec, 'utf8')));
      for (const b of bad) console.warn(`  ⚠ clarify-question-quality [${b.score}] "${b.question}" — ${b.errors.join(', ')}`);
    } catch { /* best-effort — question-quality is advisory */ }
  }

  if (failures.length === 0) {
    console.log(`clarify-gate: PASS — ${specs.length} master-spec(s) have complete, fresh business-question coverage.`);
    process.exit(0);
  }

  const msg =
    `clarify-gate: BUSINESS-QUESTION GATE\n` +
    failures.map((f) => `  ✗ ${f.spec} (feature "${f.feature}"): ${f.why}`).join('\n') + '\n' +
    `  A master spec cannot close on under-elicited input. Run the clarify engine first:\n` +
    `    node scripts/clarify-engine.mjs --feature <name> --plan\n` +
    `  Answer (or explicitly --defer with a reason) every category until COMPLETE, then re-stage.`;

  if (block) { console.error(msg); process.exit(1); }
  console.warn(msg);
  process.exit(0);
}

function selfTest() {
  let fail = 0;
  const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); fail++; } };
  console.log('clarify-gate --self-test');

  ok(featureFromSpecPath('docs/specs/wave-foo_MASTER_SPEC.md') === 'wave-foo', 'feature derived from master-spec path');
  ok(featureFromSpecPath('docs/specs/sub/My_Thing_MASTER_SPEC.md') === 'my-thing', 'nested + mixed-case spec slugified');
  ok(isMasterSpec('docs/specs/x_MASTER_SPEC.md'), 'recognises a master spec');
  ok(!isMasterSpec('docs/specs/_LINEAGE.md'), 'ignores non-master spec files');
  ok(!isMasterSpec('scripts/foo.mjs'), 'ignores non-spec files');
  ok(parseSince('48h') === 48 * 3600_000, 'parses since window');
  ok(parseSince('bad') === 24 * 3600_000, 'falls back to 24h default');

  // In-memory coverage completeness (no disk).
  const full = { categories: { a: { state: 'clear' }, b: { state: 'deferred', reason: 'later' } } };
  const part = { categories: { a: { state: 'clear' }, b: { state: 'missing' } } };
  const defNoReason = { categories: { a: { state: 'deferred', reason: '' } } };
  const rd = (obj) => () => JSON.stringify(obj);
  ok(coverageComplete('x', rd(full), () => true).complete, 'all clear/deferred-with-reason → complete');
  ok(!coverageComplete('x', rd(part), () => true).complete, 'a missing category → incomplete');
  ok(!coverageComplete('x', rd(defNoReason), () => true).complete, 'deferred without reason → incomplete');
  ok(!coverageComplete('x', () => '', () => false).complete, 'no coverage file → incomplete');

  // JTBD-frame (W29-R5)
  ok(jtbdFrame('Когда менеджер закрывает сделку, он хочет отчёт, чтобы увидеть маржу').framed, 'RU situation+motivation+outcome → framed');
  ok(jtbdFrame('When a rep closes a deal, they want a report so that margin is visible').framed, 'EN situation+motivation+outcome → framed');
  ok(!jtbdFrame('нужна кнопка экспорта в PDF').framed, 'bare solution noun → not framed');
  ok(jtbdFrame('нужна кнопка экспорта').missing.includes('situation') && jtbdFrame('нужна кнопка экспорта').missing.includes('outcome'), 'solution noun is missing situation + outcome slots');
  ok(jtbdCoverage({ categories: { problem: { state: 'clear', answer: 'просто фича без рамки' } } }).length === 1, 'jtbdCoverage warns on an unframed clear problem answer');
  ok(jtbdCoverage({ categories: { problem: { state: 'clear', answer: 'Когда X, я хочу Y, чтобы Z' } } }).length === 0, 'jtbdCoverage silent on a framed answer');
  ok(jtbdCoverage({ categories: { problem: { state: 'missing', answer: '' } } }).length === 0, 'jtbdCoverage skips a missing/unanswered problem (no false warn)');

  console.log(fail === 0 ? '\nclarify-gate: all self-tests passed' : `\nclarify-gate: ${fail} self-test(s) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

// Run only when invoked directly — importing for tests must not trigger main()/exit.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
