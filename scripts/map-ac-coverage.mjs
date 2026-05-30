#!/usr/bin/env node
// wave-134 — Retrospective cross-wave AC auditor. NOT test-engineer (per-wave prospective agent).
// NOT wave-130 (property testing). NOT wave-131 (mutation testing). Dev-tooling only.
// Reads docs/specs/wave-*_MASTER_SPEC.md, maps each AC to test files, writes
// docs/metrics/ac-coverage-map.json and tests/spec-stubs/wave-NN.spec-stubs.test.ts stubs.
// SOURCE: extractACs imported from scripts/sync-specs-to-memory.mjs:114–123 — do not diverge.
/**
 * Usage:
 *   node scripts/map-ac-coverage.mjs          # report + generate stubs, exit 0
 *   node scripts/map-ac-coverage.mjs --strict  # exit 1 if any uncovered ACs exist
 *   node scripts/map-ac-coverage.mjs --dry     # print summary, no file writes
 *
 * Outputs:
 *   docs/metrics/ac-coverage-map.json   — per-wave per-AC traceability artifact
 *   tests/spec-stubs/wave-NN.spec-stubs.test.ts — it.todo stubs for uncovered ACs
 *
 * D4 hard boundary: only it.todo() stubs are generated. No passing test bodies.
 * D5 honesty: first run will show ~0 covered — that is the correct, load-bearing output.
 * D6 no CI gate in v1: --strict exists for manual use only, not wired to any workflow.
 * D7 legacy format: specs with zero extractACs hits are reported, not silently skipped.
 * D8 no telemetry stream: zero new .jsonl files; emit-telemetry.mjs untouched.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// D1 — REUSE: import extractACs from sync-specs-to-memory.mjs:114–123. No new parser.
import { extractACs } from './sync-specs-to-memory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SPECS_DIR = path.join(ROOT, 'docs', 'specs');
const TESTS_DIR = path.join(ROOT, 'tests');
const METRICS_DIR = path.join(ROOT, 'docs', 'metrics');
const STUBS_DIR = path.join(ROOT, 'tests', 'spec-stubs');
const COVERAGE_MAP_PATH = path.join(METRICS_DIR, 'ac-coverage-map.json');

// ── CLI args ───────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const isStrict = args.has('--strict');
const isDry = args.has('--dry');

// ── Spec-ID helpers ────────────────────────────────────────────────────────────
function inferWaveId(filename) {
  const m = filename.match(/^wave-([\d]+(?:\.[\d]+[a-z]?)?)/);
  if (m) return `wave-${m[1]}`;
  return filename.replace(/_MASTER_SPEC\.md$/, '');
}

function parseWaveNumber(waveId) {
  const m = waveId.match(/^wave-(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
}

// Wave-17..78 boundary: specs in this range without [role] tags are legacy format.
// wave-83 partially matches but is flagged only if extractACs returns zero results.
function isLikelyLegacy(waveNumber) {
  return waveNumber > 0 && waveNumber <= 78;
}

// ── Test-file AC tag grep ──────────────────────────────────────────────────────
// Collect all lines from tests/ that contain "// AC-N" or "// wave-NN AC-N" patterns.
// Explicitly excludes "// Falsifiability documentation (AC-7)" section comments
// (per D5 / REFLEXION-1: those are prose section headers, not linkage tags).
//
// Tag formats recognised:
//   // AC-1:          (bare AC label — wave-local link)
//   // AC-1 <text>    (bare AC label followed by text)
//   // wave-NN AC-1:  (cross-wave qualified link)
//
// NOT recognised (D5):
//   // Falsifiability documentation (AC-7)   — section comment, not a linkage tag
//   // AC-... inside a word like "CACHE"      — not matched (requires word boundary)

const TAG_RE = /\/\/\s+(wave-\d+\s+)?AC-(\w+)(?::|[\s])/;

/** @returns {Map<string, { file: string, line: number, isStub: boolean }[]>} wave-qualified-ac_id -> hits */
function collectTestTags() {
  const tagMap = new Map(); // wave-qualified acKey -> [{file, line, isStub}]

  function walkDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // skip node_modules, .next, .claude, and spec-stubs (our own generated output).
        // CRITICAL: never scan tests/spec-stubs — it contains our own generated it.todo files
        // which would self-inflate coverage counts on re-run (anti-pattern #7 / false-signal).
        if (
          entry.name === 'node_modules' ||
          entry.name === '.next' ||
          entry.name === '.claude' ||
          full === STUBS_DIR
        ) continue;
        walkDir(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        let content;
        try {
          content = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Exclude "Falsifiability documentation (AC-7)" section comments (D5 / REFLEXION-1)
          if (/Falsifiability documentation/i.test(line)) continue;
          const m = TAG_RE.exec(line);
          if (!m) continue;
          const waveQualifier = m[1] ? m[1].trim() : null; // e.g. "wave-130"
          const acNum = m[2]; // e.g. "1", "12", "7"

          // Determine if this is a stub line (it.todo / test.todo)
          // Look at next non-blank line or same line
          const surroundingContext = lines.slice(Math.max(0, i - 1), i + 3).join('\n');
          const isStub = /\bit\.todo\b|\btest\.todo\b/.test(surroundingContext);

          const acKey = waveQualifier ? `${waveQualifier}:AC-${acNum}` : `AC-${acNum}`;
          if (!tagMap.has(acKey)) tagMap.set(acKey, []);
          tagMap.get(acKey).push({
            file: path.relative(ROOT, full),
            line: i + 1,
            isStub,
          });
        }
      }
    }
  }

  walkDir(TESTS_DIR);
  return tagMap;
}

// ── Classify a single AC against the tag map ──────────────────────────────────
// Returns: { status: 'covered' | 'uncovered', test_file: string | null }
//
// HONESTY MODEL (wave-134 R2 fix):
//   covered   = a real AC-tagged test WITH assertions (not it.todo) in a NON-stub file,
//               tagged with a WAVE-QUALIFIED comment: "// wave-NN AC-N:"
//   uncovered = no real test (the generated it.todo stub in tests/spec-stubs/ does NOT
//               count — the stub dir is excluded from scanning, so stubs can never appear
//               in tagMap at all). This is the honest load-bearing baseline.
//
// BARE-KEY CROSS-WAVE COLLISION FIX:
//   Only wave-qualified keys ("wave-130:AC-7") are accepted. Bare "AC-7" matches in any
//   test file are IGNORED for classification — a bare "// AC-1" comment in wave-167's
//   stub or any other file must NOT satisfy wave-84's AC-1.
//   Bare keys were the source of false cross-wave traceability (anti-pattern #7).
function classifyAC(waveId, acLabel, tagMap) {
  // Only wave-qualified key: "wave-130:AC-7"
  const qualifiedKey = `${waveId}:${acLabel}`;
  const qualifiedHits = tagMap.get(qualifiedKey) ?? [];

  if (qualifiedHits.length === 0) {
    return { status: 'uncovered', test_file: null };
  }

  // If ANY hit is a non-stub (real test body with assertions), classify as covered.
  // isStub is detected from surrounding it.todo context in collectTestTags.
  const realHits = qualifiedHits.filter((h) => !h.isStub);
  if (realHits.length > 0) {
    return { status: 'covered', test_file: realHits[0].file };
  }
  // All hits are it.todo in non-stub files (stub dir is excluded from scan).
  // Still uncovered — a todo is not coverage.
  return { status: 'uncovered', test_file: null };
}

// ── Stub file generator ────────────────────────────────────────────────────────
// D4: only it.todo stubs. NO expect(), NO passing test bodies.
function generateStubFile(waveId, uncoveredAcs) {
  if (uncoveredAcs.length === 0) return null;

  const lines = [
    `// wave-134 generated stub — it.todo stubs are NOT coverage. Fill assertions via test-engineer dispatch.`,
    `// SOURCE: docs/specs/${waveId}_MASTER_SPEC.md — ACs with no linked test as of generation time.`,
    `// AC-N tags must be added above each it() when a real assertion is written.`,
    ``,
    `import { describe, it } from 'vitest';`,
    ``,
    `describe('${waveId} — AC coverage stubs', () => {`,
  ];

  for (const ac of uncoveredAcs) {
    const acLabel = ac.label ?? 'AC-?';
    // Truncate title to ~100 chars for readability
    const titleRaw = ac.text.replace(/\*\*/g, '').trim();
    const title = titleRaw.length > 100 ? titleRaw.slice(0, 97) + '...' : titleRaw;
    lines.push(`  // ${acLabel}: ${title}`);
    lines.push(`  it.todo('${acLabel}: ${title.replace(/'/g, "\\'")}');`);
    lines.push(``);
  }

  lines.push(`});`);
  lines.push(``);
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  // 1. Collect all spec files
  let specFiles;
  try {
    specFiles = fs
      .readdirSync(SPECS_DIR)
      .filter((f) => /^wave-[\d]/.test(f) && f.endsWith('_MASTER_SPEC.md'))
      .sort();
  } catch (err) {
    console.error(`[map-ac-coverage] ERROR: could not read ${SPECS_DIR}: ${err.message}`);
    process.exit(1);
  }

  // 2. Collect test AC tags
  const tagMap = collectTestTags();

  // 3. Walk specs, extract ACs, classify
  const waveResults = [];
  let totalACs = 0;
  let totalCovered = 0;
  let totalUncovered = 0;
  let legacySkipped = 0;
  const legacySpecNames = [];
  let parsedSpecCount = 0;

  for (const file of specFiles) {
    const waveId = inferWaveId(file);
    const waveNum = parseWaveNumber(waveId);
    const filePath = path.join(SPECS_DIR, file);

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      console.warn(`[map-ac-coverage] WARNING: could not read ${file} — skipping`);
      continue;
    }

    const acs = extractACs(content);

    if (acs.length === 0) {
      // D7: report unmapped specs — don't silently skip
      legacySkipped++;
      legacySpecNames.push(waveId);
      const legacyLabel = isLikelyLegacy(waveNum)
        ? 'legacy AC format (pre-[role]-tag era)'
        : 'zero AC hits (unstructured or lens-waived format)';
      console.log(`[map-ac-coverage] ${waveId}: 0 ACs extracted — ${legacyLabel}. legacy AC format — manual review required.`);
      continue;
    }

    parsedSpecCount++;
    const acRows = [];
    let waveCovered = 0;
    let waveUncovered = 0;

    for (const ac of acs) {
      const acLabel = ac.label ?? 'AC-?';
      const { status, test_file } = classifyAC(waveId, acLabel, tagMap);

      acRows.push({
        ac_id: acLabel,
        title: ac.text.replace(/\*\*/g, '').trim().slice(0, 120),
        status,
        test_file: test_file ?? null,
      });

      if (status === 'covered') waveCovered++;
      else waveUncovered++;
    }

    totalACs += acs.length;
    totalCovered += waveCovered;
    totalUncovered += waveUncovered;

    waveResults.push({
      wave_id: waveId,
      spec_file: `docs/specs/${file}`,
      total_acs: acs.length,
      covered: waveCovered,
      uncovered: waveUncovered,
      acs: acRows,
    });
  }

  // 4. Print legacy-format warning summary (D7)
  if (legacySkipped > 0) {
    console.log(
      `[map-ac-coverage] ${legacySkipped} specs use legacy AC format — zero ACs extracted; manual review required. (${legacySpecNames.join(', ')})`
    );
  }

  // 5. Coverage summary
  const coveredPct = totalACs > 0 ? ((totalCovered / totalACs) * 100).toFixed(1) : '0.0';
  console.log(`\n[map-ac-coverage] Summary`);
  console.log(`  Specs scanned (total):       ${specFiles.length}`);
  console.log(`  Specs parsed (extractACs>0): ${parsedSpecCount}`);
  console.log(`  Legacy/zero-AC specs:        ${legacySkipped}`);
  console.log(`  Total ACs extracted:         ${totalACs}`);
  console.log(`  Covered (real assertions):   ${totalCovered}`);
  console.log(`  Uncovered (no test linkage): ${totalUncovered}`);
  console.log(`  Coverage %:                  ${coveredPct}% (linked-test coverage, NOT line/branch coverage)`);
  console.log(`  NOTE: generated it.todo stubs in tests/spec-stubs/ are TRACKED TODOS, not coverage.`);
  console.log(`  NOTE: ~0% is the HONEST baseline on first run — this is correct per D5.`);

  // 6. Build coverage map artifact
  const coverageMap = {
    generated_at: new Date().toISOString(),
    total_specs_scanned: specFiles.length,
    legacy_format_specs_skipped: legacySkipped,
    legacy_spec_ids: legacySpecNames,
    parseable_specs: parsedSpecCount,
    total_acs: totalACs,
    covered: totalCovered,
    uncovered: totalUncovered,
    coverage_pct: parseFloat(coveredPct),
    note: 'covered = real test with wave-qualified AC tag (// wave-NN AC-N:) AND real assertions (not it.todo). uncovered = everything else. Generated it.todo stubs in tests/spec-stubs/ are tracked work items, NOT coverage — the stub dir is excluded from the coverage scan to prevent self-inflation.',
    waves: waveResults,
  };

  // 7. Write coverage map (D5)
  if (!isDry) {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    fs.writeFileSync(COVERAGE_MAP_PATH, JSON.stringify(coverageMap, null, 2));
    console.log(`\n[map-ac-coverage] wrote docs/metrics/ac-coverage-map.json`);
  } else {
    console.log(`\n[map-ac-coverage] --dry: skipping file writes`);
  }

  // 8. Generate stub files for waves with uncovered ACs (D4)
  if (!isDry) {
    fs.mkdirSync(STUBS_DIR, { recursive: true });
    let stubFilesWritten = 0;

    for (const wave of waveResults) {
      const uncoveredAcs = wave.acs.filter((a) => a.status === 'uncovered');
      if (uncoveredAcs.length === 0) continue;

      // Re-fetch the full AC objects (with label + text) from the spec for stub generation
      const file = specFiles.find((f) => inferWaveId(f) === wave.wave_id);
      if (!file) continue;
      let content;
      try {
        content = fs.readFileSync(path.join(SPECS_DIR, file), 'utf8');
      } catch {
        continue;
      }
      const allAcs = extractACs(content);
      const uncoveredLabels = new Set(uncoveredAcs.map((a) => a.ac_id));
      const uncoveredAcsFull = allAcs.filter((ac) => uncoveredLabels.has(ac.label ?? 'AC-?'));

      const stubContent = generateStubFile(wave.wave_id, uncoveredAcsFull);
      if (!stubContent) continue;

      const stubPath = path.join(STUBS_DIR, `${wave.wave_id}.spec-stubs.test.ts`);
      fs.writeFileSync(stubPath, stubContent);
      stubFilesWritten++;
    }

    if (stubFilesWritten > 0) {
      console.log(`[map-ac-coverage] wrote ${stubFilesWritten} stub file(s) to tests/spec-stubs/`);
      console.log(`[map-ac-coverage] REMINDER: it.todo stubs are NOT coverage. Fill via test-engineer dispatch.`);
    }
  }

  // 9. Exit (D6: default exit 0; --strict exits 1 only if uncovered > 0)
  if (isStrict && totalUncovered > 0) {
    console.log(`\n[map-ac-coverage] --strict: ${totalUncovered} uncovered ACs → exit 1`);
    process.exit(1);
  }

  process.exit(0);
}

main();
