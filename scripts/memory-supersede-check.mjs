#!/usr/bin/env node
// Memory supersede check — the "validity window" detector (Graphiti pattern). When a NEWER fact
// contradicts an OLDER fact about the same entity (same subject prefix, different value), the old
// fact should be MARKED superseded, not silently left to coexist and never deleted. ADVISORY scanner:
// reads the per-class snapshot .md files (and optionally a staging JSON), finds same-entity /
// same-subject / different-predicate pairs, prints them as candidates with a suggested
// `[superseded YYYY-MM-DD by: …]` marker. It NEVER edits memory; marking is a confirmed,
// agent-performed MCP step (docs/MEMORY_MERGE_PROTOCOL.md §7). Conservative by design: same-subject
// + different-predicate is the ENTIRE rule — no fuzzy/NLP, no cross-entity compare.
//
// FULL & self-tested. Usage:
//   node scripts/memory-supersede-check.mjs                # advisory report; always exit 0
//   node scripts/memory-supersede-check.mjs --strict       # exit 1 if any unmarked contradiction
//   node scripts/memory-supersede-check.mjs <staging.json>  # also fold staged entities in (newer)
//   node scripts/memory-supersede-check.mjs --json         # machine-readable candidates[]
//   node scripts/memory-supersede-check.mjs --self-test    # planted-fixture assertions

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// The five per-class snapshot files the scanner reads (same set restore-memory uses).
export const SNAPSHOT_FILES = [
  'docs/memory-anti-patterns.md',
  'docs/memory-waves.md',
  'docs/memory-specs.md',
  'docs/memory-skills.md',
  'docs/memory-lessons.md',
];

// The marker that means "this observation has already been retired in favour of a newer one".
export const SUPERSEDE_MARKER = /\s\[superseded \d{4}-\d{2}-\d{2} by: [^\]]+\]\s*$/;

// SINGLE-VALUED state/config subject keys: a thing has exactly ONE current value, so two different
// values for the same key = the value CHANGED (a real supersede). Added in round 2 after the
// adversarial review showed the bare "same subject / diff predicate" rule false-fires on inherently
// MULTI-valued subjects (lesson / trigger / example / prevention …), where two values are both true.
// Conservative on purpose: anything NOT in this set is never flagged. Subject is normalized lowercase.
export const SINGLE_VALUED_KEYS = new Set([
  'status', 'default', 'version', 'value', 'color', 'theme', 'theme color', 'theme accent',
  'mode', 'port', 'path', 'current', 'state', 'decision', 'owner', 'target', 'result',
  'verdict', 'baseline', 'threshold', 'choice', 'winner', 'setting', 'model', 'source of truth',
]);

// ── pure core (each function < 40 LOC) ────────────────────────────────────────

// Parse `### \`name\`` … `**Observations**:` blocks. Same block grammar as
// restore-memory-from-snapshots.mjs:71; tolerant of empty files (→ []).
export function parseEntities(markdown) {
  const entities = [];
  const lines = String(markdown || '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const header = lines[i].match(/^###\s+`([^`]+)`\s*$/);
    if (!header) { i++; continue; }
    const name = header[1];
    let type = '', wave, inObs = false;
    const observations = [];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (/^###\s+`/.test(l) || /^---\s*$/.test(l)) break;
      const tM = l.match(/^\*\*Type\*\*:\s*(.+)$/);
      const wM = l.match(/^\*\*Wave\*\*:\s*(.+)$/);
      if (tM) { type = tM[1].trim(); inObs = false; i++; continue; }
      if (wM) { const w = wM[1].trim(); wave = w === '—' ? undefined : w; inObs = false; i++; continue; }
      if (/^\*\*Observations\*\*:/.test(l)) { inObs = true; i++; continue; }
      if (inObs) {
        const b = l.match(/^-\s+(.*)$/);
        if (b) { observations.push(b[1].trim()); i++; continue; }
        if (l.trim() === '') { i++; continue; }
        inObs = false;
      }
      i++;
    }
    if (name && name !== '—') entities.push({ name, type, wave, observations });
  }
  return entities;
}

// Split an observation into { subject, predicate, hasColon } on the FIRST colon. Both sides are
// normalized: trim, collapse internal whitespace, lowercase.
export function splitSubjectPredicate(obs) {
  const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const idx = String(obs).indexOf(':');
  if (idx === -1) return { subject: norm(obs), predicate: '', hasColon: false };
  return { subject: norm(obs.slice(0, idx)), predicate: norm(obs.slice(idx + 1)), hasColon: true };
}

// True iff the observation already carries a `[superseded YYYY-MM-DD by: …]` marker.
export function isSuperseded(obs) {
  return SUPERSEDE_MARKER.test(String(obs));
}

// For each entity, compare every unordered pair (i<j) of its observations. Emit a candidate when
// same normalized subject AND different predicate AND neither is already a marker. oldObservation =
// the earlier (lower index) one, newObservation = the later one.
export function detectContradictions(entities, { today } = {}) {
  const when = today || todayISO();
  const candidates = [];
  for (const ent of entities || []) {
    const obs = ent.observations || [];
    // Count how often each subject appears among real (non-marker, has-colon) observations. A
    // single-valued key that appears EXACTLY twice is a value-change; 3+ is an enumeration, not a change.
    const subjectCount = new Map();
    for (const o of obs) {
      if (isSuperseded(o)) continue;
      const s = splitSubjectPredicate(o);
      if (!s.hasColon) continue;
      subjectCount.set(s.subject, (subjectCount.get(s.subject) || 0) + 1);
    }
    for (let i = 0; i < obs.length; i++) {
      for (let j = i + 1; j < obs.length; j++) {
        const a = obs[i], b = obs[j];
        if (isSuperseded(a) || isSuperseded(b)) continue; // markers don't supersede / aren't re-flagged
        const sa = splitSubjectPredicate(a), sb = splitSubjectPredicate(b);
        if (!sa.hasColon || !sb.hasColon) continue;        // no-colon pairs can't contradict
        if (sa.subject !== sb.subject) continue;           // different subject → not a candidate
        if (sa.predicate === sb.predicate) continue;       // duplicate → not a contradiction
        if (!SINGLE_VALUED_KEYS.has(sa.subject)) continue; // multi-valued subject → both can be true
        if (subjectCount.get(sa.subject) !== 2) continue;  // 3+ values = enumeration, not a change
        const successor = sb.predicate.slice(0, 60).trim() || ent.wave || 'newer fact';
        candidates.push({
          entity: ent.name,
          subject: sa.subject,
          oldObservation: a,
          newObservation: b,
          suggestedMarker: `${a} [superseded ${when} by: ${successor}]`,
        });
      }
    }
  }
  // deterministic order: by entity, then by old/new text
  candidates.sort((x, y) =>
    x.entity < y.entity ? -1 : x.entity > y.entity ? 1 :
    x.oldObservation < y.oldObservation ? -1 : x.oldObservation > y.oldObservation ? 1 :
    x.newObservation < y.newObservation ? -1 : x.newObservation > y.newObservation ? 1 : 0);
  return candidates;
}

// Build the human-readable / strict-exit-code report for a candidate list.
export function report(candidates, { strict } = {}) {
  const cands = candidates || [];
  const n = cands.length;
  const bar = '─'.repeat(57);
  let text;
  if (n === 0) {
    text = '✓ memory:supersede clean — 0 single-valued keys changed without a marker';
  } else {
    const blocks = cands.map((c) =>
      `  entity: ${c.entity}\n    old: ${c.oldObservation}\n    new: ${c.newObservation}\n    suggest: ${c.suggestedMarker}`
    ).join('\n\n');
    text =
      `${bar}\nmemory:supersede — ${n} value-change candidate(s): a single-valued key got a new value (advisory)\n${bar}\n\n` +
      `${blocks}\n\n` +
      `0 = clean. To apply a marker: confirm, then edit the snapshot and/or mark via the MCP merge\n` +
      `(see docs/MEMORY_MERGE_PROTOCOL.md step 7). This script never edits memory.`;
  }
  const exitCode = strict ? (n > 0 ? 1 : 0) : 0;
  return { text, exitCode };
}

// ── I/O helpers (thin, impure) ────────────────────────────────────────────────

// Read the five snapshot files from disk and return their parsed entities, tolerant of absence.
export function loadSnapshotEntities(root = ROOT) {
  const out = [];
  for (const rel of SNAPSHOT_FILES) {
    const full = join(root, rel);
    if (!existsSync(full)) continue;            // empty/absent file → zero entities, don't crash
    out.push(...parseEntities(readFileSync(full, 'utf8')));
  }
  return out;
}

// Fold a staging JSON's entities[].observations[] in as NEWER observations for matching names.
// Entities present only in staging are added too. Returns a new merged entity list.
export function foldStaging(entities, staging) {
  const merged = (entities || []).map((e) => ({ ...e, observations: [...(e.observations || [])] }));
  const byName = new Map(merged.map((e) => [e.name, e]));
  for (const se of (staging && staging.entities) || []) {
    const tgt = byName.get(se.name);
    if (tgt) {
      tgt.observations.push(...(se.observations || []));   // staged = appended last = newest
    } else {
      const ne = { name: se.name, type: se.entityType || '', wave: se.wave, observations: [...(se.observations || [])] };
      merged.push(ne); byName.set(ne.name, ne);
    }
  }
  return merged;
}

// ── self-test ─────────────────────────────────────────────────────────────────

function selfTest() {
  const today = '2026-06-06';
  const entities = [
    {
      name: 'config-x',
      type: 'Spec',
      observations: [
        'Status: experimental',
        'Status: production',  // (a) single-valued key, value changed → FLAGGED
        'Lesson: ship small',  // unrelated, single occurrence
      ],
    },
    // ── reviewer's false-positive cases (round 2): MULTI-valued subjects, both values true → NOT flagged
    {
      name: 'multi-lesson',
      type: 'Lesson',
      observations: [
        'Lesson: think before touching files',
        'Lesson: no done without proof',  // two distinct lessons, both true → NOT flagged
      ],
    },
    {
      name: 'multi-trigger',
      type: 'AntiPattern',
      observations: [
        'Trigger: holistic phrases fire',
        'Trigger: vague scope appears',  // multi-cause trigger → NOT flagged
      ],
    },
    {
      name: 'multi-prevention',
      type: 'AntiPattern',
      observations: [
        'Prevention: run gate A before dispatch',
        'Prevention: run gate B before dispatch',  // two preventions, both apply → NOT flagged
      ],
    },
    {
      name: 'three-status',
      type: 'Spec',
      observations: [
        'Status: a', 'Status: b', 'Status: c',  // single-valued key but 3 values = enumeration → NOT flagged
      ],
    },
    {
      name: 'dup-entity',
      type: 'AntiPattern',
      observations: [
        'Status: live',
        'Status: live', // (b) duplicate — same subject AND predicate → NOT a candidate
      ],
    },
    {
      name: 'already-marked',
      type: 'Spec',
      observations: [
        // (c) old line already carries a marker → must NOT be re-flagged
        'Status: old [superseded 2026-05-01 by: new]',
        'Status: new',
      ],
    },
    {
      name: 'diff-subject',
      type: 'AntiPattern',
      observations: [
        'Status: ok', // (d) different subject from the next → NOT a candidate
        'Mode: fast',
      ],
    },
    {
      name: 'no-colon',
      type: 'AntiPattern',
      observations: [
        'free form text without a colon', // (e) no-colon pair → NOT a candidate
        'another free form text without a colon',
      ],
    },
  ];

  const cand = detectContradictions(entities, { today });
  const cand2 = detectContradictions(entities, { today });
  const entityNames = (cand || []).map((c) => c.entity);
  const theOne = (cand || []).find((c) => c.entity === 'config-x');

  const cleanReport = report([], { strict: true });
  const dirtyReport = report(cand || [], { strict: true });
  const advisoryReport = report(cand || [], { strict: false });

  // (h) staging fold-in: a brand-new staged fact supersedes a snapshot fact under the same entity.
  const baseForStaging = [
    { name: 'staged-target', type: 'AntiPattern', observations: ['Status: experimental'] },
  ];
  const folded = foldStaging(baseForStaging, {
    entities: [
      { name: 'staged-target', observations: ['Status: production'] },
    ],
  });
  const stagedCand = detectContradictions(folded, { today });

  const markerRe = /\s\[superseded \d{4}-\d{2}-\d{2} by: [^\]]+\]$/;

  const T = [
    // AC-1 — value-change detected with the right shape (single-valued key)
    ['(a) single-valued key changed → 1 candidate for config-x',
      !!theOne && theOne.oldObservation === 'Status: experimental' &&
      theOne.newObservation === 'Status: production'],
    // round-2 false-positive guards: MULTI-valued subjects must NOT be flagged
    ['(fp1) two Lesson: observations → NOT flagged', !entityNames.includes('multi-lesson')],
    ['(fp2) two Trigger: observations → NOT flagged', !entityNames.includes('multi-trigger')],
    ['(fp3) two Prevention: observations → NOT flagged (reviewer headline case)', !entityNames.includes('multi-prevention')],
    ['(fp4) three Status: values (enumeration, not a change) → NOT flagged', !entityNames.includes('three-status')],
    // AC-2 — duplicate not flagged
    ['(b) duplicate (same subject AND predicate) → NOT flagged', !entityNames.includes('dup-entity')],
    // AC-3 — already-marked not re-flagged
    ['(c) already-[superseded …] pair → NOT re-flagged', !entityNames.includes('already-marked')],
    // AC-4 — different subject not flagged
    ['(d) different subject → NOT flagged', !entityNames.includes('diff-subject')],
    // no-colon pair not flagged
    ['(e) no-colon pair → NOT flagged', !entityNames.includes('no-colon')],
    // exactly one candidate total (only config-x)
    ['(a2) exactly 1 candidate across all fixtures', (cand || []).length === 1],
    // AC-5 — suggested marker shape
    ['(f) suggestedMarker = <old> [superseded <today> by: <successor>] and matches the regex',
      !!theOne && markerRe.test(theOne.suggestedMarker) &&
      theOne.suggestedMarker.startsWith(theOne.oldObservation + ' [superseded ' + today + ' by: ')],
    // AC-7 — strict exit code
    ['(g) --strict: clean → exit 0', cleanReport.exitCode === 0],
    ['(g) --strict: ≥1 candidate → exit 1', dirtyReport.exitCode === 1],
    ['(g) advisory (non-strict): exit 0 even with candidates', advisoryReport.exitCode === 0],
    // AC-8 — staging fold
    ['(h) staged observation folded as newer → supersedes snapshot fact',
      Array.isArray(stagedCand) && stagedCand.some((c) => c.entity === 'staged-target')],
    // isSuperseded helper
    ['isSuperseded() true on a marked line',
      isSuperseded('foo: bar [superseded 2026-01-01 by: baz]') === true],
    ['isSuperseded() false on a bare line', isSuperseded('foo: bar') === false],
    // splitSubjectPredicate helper
    ['splitSubjectPredicate normalizes + splits on first colon',
      (() => { const s = splitSubjectPredicate('  Prevention :  Do  X  '); return s.subject === 'prevention' && s.predicate === 'do x' && s.hasColon === true; })()],
    // parseEntities tolerant of empty input
    ['parseEntities("") → [] (empty file tolerated)', Array.isArray(parseEntities('')) && parseEntities('').length === 0],
    // round-2 vector 5: foldStaging tolerates malformed/empty staging without throwing
    ['(j) foldStaging(base, null) does not throw', (() => { try { return foldStaging(baseForStaging, null).length === 1; } catch { return false; } })()],
    ['(j) foldStaging(base, {}) does not throw', (() => { try { return foldStaging(baseForStaging, {}).length === 1; } catch { return false; } })()],
    ['(j) foldStaging(base, {entities:null}) does not throw', (() => { try { return foldStaging(baseForStaging, { entities: null }).length === 1; } catch { return false; } })()],
    // AC-10 — determinism
    ['(i) deterministic (same input → identical JSON)', JSON.stringify(cand) === JSON.stringify(cand2)],
  ];

  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log(`\n\x1b[31mmemory-supersede-check self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ memory-supersede-check detects contradictions conservatively\x1b[0m');
  process.exit(0);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();

  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const stagingArg = argv.find((a) => !a.startsWith('--'));

  let entities = loadSnapshotEntities();
  if (stagingArg) {
    if (!existsSync(stagingArg)) { console.error(`memory-supersede: staging file not found: ${stagingArg}`); process.exit(2); }
    let staged;
    try { staged = JSON.parse(readFileSync(stagingArg, 'utf8')); }
    catch { console.error(`memory-supersede: staging file is not valid JSON: ${stagingArg}`); process.exit(2); }
    entities = foldStaging(entities, staged);   // foldStaging tolerates null / missing entities[]
  }

  const candidates = detectContradictions(entities, { today: todayISO() });

  if (asJson) {
    process.stdout.write(JSON.stringify({ today: todayISO(), count: candidates.length, candidates }, null, 2) + '\n');
    process.exit(strict ? (candidates.length ? 1 : 0) : 0);
  }

  const { text, exitCode } = report(candidates, { strict });
  process.stdout.write(text + '\n');
  process.exit(exitCode);
}

// local today helper (kept tiny; no dep on meta-lib so the scanner stays standalone)
export function todayISO() {
  if (process.env.META_TODAY) return process.env.META_TODAY;
  return new Date().toISOString().slice(0, 10);
}
