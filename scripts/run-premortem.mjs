#!/usr/bin/env node
/**
 * run-premortem.mjs — Wave-156 Pre-Mortem Agent
 *
 * Prospective failure projection for wave specs. Dispatches 4 parallel
 * npx claude --print lens calls (Technical, Scope, Integration, Anti-pattern
 * Recurrence) before a 1 sequential synthesis call. Produces:
 *   - docs/quality/risk-assessments/wave-NNN.md  (Article 9 artifact)
 *   - docs/quality/risk-assessments/_TAXONOMY.md (append-only taxonomy)
 *   - docs/audits/agent-events.jsonl             (wave-147 telemetry)
 *
 * Usage:
 *   node scripts/run-premortem.mjs --wave wave-NNN
 *   node scripts/run-premortem.mjs --wave wave-NNN --dry
 *   node scripts/run-premortem.mjs --help
 *
 * Exit codes:
 *   0   Success (artifact written, or dry-run complete)
 *   1   Error (spec not found, unhandled error)
 *
 * LLM mechanism: npx claude --print subprocess (NO Anthropic SDK).
 * Model: claude-sonnet-4-5
 * Cost estimate: ~$0.25 per wave (5 LLM calls: 4 lenses + 1 synthesis)
 *
 * Authority: .claude/agents/pre-mortem-agent.md
 * Spec: docs/specs/wave-156_MASTER_SPEC.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { emitTelemetry } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ───────────────────────────────────────────────────────────────────
const ANTI_PATTERNS_PATH = path.join(ROOT, 'docs', 'ANTI_PATTERNS_CATALOG.md');
const RECURRENCE_PATH = path.join(ROOT, 'docs', 'audits', 'recurrence-events.jsonl');
const RISK_ASSESSMENTS_DIR = path.join(ROOT, 'docs', 'quality', 'risk-assessments');
const TAXONOMY_PATH = path.join(RISK_ASSESSMENTS_DIR, '_TAXONOMY.md');
const AGENT_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'agent-events.jsonl');
const CONFIG_PATH = path.join(ROOT, '.sdd-config.json');

const MODEL = 'claude-sonnet-4-5';

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

function hasFlag(flag) {
  return args.includes(flag);
}

// ── Help ─────────────────────────────────────────────────────────────────────
if (hasFlag('--help')) {
  process.stdout.write(`
run-premortem.mjs — Wave-156 Pre-Mortem Agent

Usage:
  node scripts/run-premortem.mjs --wave <wave-NNN>
  node scripts/run-premortem.mjs --wave <wave-NNN> --dry
  node scripts/run-premortem.mjs --help

Flags:
  --wave <wave-NNN>  Required. Wave identifier (e.g., wave-156).
                     Reads docs/specs/<wave-NNN>_MASTER_SPEC.md.
  --dry              Dry-run mode. Prints 4-lens prompts and synthesis
                     structure to stdout. Does NOT invoke LLM or write files.
                     Exits 0.
  --help             Show this help text and exit 0.

Exit codes:
  0   Success or dry-run complete
  1   Spec not found or unhandled error

Example:
  node scripts/run-premortem.mjs --wave wave-156 --dry
  npm run premortem -- --wave wave-156

Config (.sdd-config.json):
  preMortem.enabled: false          -> soft-gate default (runs but does not block)
  andonCord.hardBlockEnabled: true  -> enables hard-block mode
`);
  process.exit(0);
}

// ── Wave flag ────────────────────────────────────────────────────────────────
const waveArg = getArg('--wave');
const isDry = hasFlag('--dry') || hasFlag('--dry-run');

if (!waveArg) {
  process.stderr.write('[premortem] ERROR: --wave <wave-NNN> is required. Run with --help for usage.\n');
  process.exit(1);
}

// ── Spec file check (A1) ─────────────────────────────────────────────────────
const specPath = path.join(ROOT, 'docs', 'specs', `${waveArg}_MASTER_SPEC.md`);
if (!fs.existsSync(specPath)) {
  process.stderr.write(`[premortem] ERROR: spec not found: docs/specs/${waveArg}_MASTER_SPEC.md\n`);
  process.exit(1);
}

// ── Read inputs ──────────────────────────────────────────────────────────────
const specText = fs.readFileSync(specPath, 'utf8');

let antiPatternsText = '';
if (fs.existsSync(ANTI_PATTERNS_PATH)) {
  antiPatternsText = fs.readFileSync(ANTI_PATTERNS_PATH, 'utf8');
} else {
  process.stderr.write('[premortem] WARN: docs/ANTI_PATTERNS_CATALOG.md not found. Lenses will proceed without catalog context.\n');
}

// Lens 4: last-24h recurrence-events.jsonl content (A10 + T6)
let recurrenceContext = 'no recent recurrence data';
if (fs.existsSync(RECURRENCE_PATH)) {
  const raw = fs.readFileSync(RECURRENCE_PATH, 'utf8').trim();
  if (raw.length > 0) {
    // Filter to last 24h events
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const recent = lines.filter(line => {
      try {
        const obj = JSON.parse(line);
        const ts = new Date(obj.timestamp || obj.time || 0).getTime();
        return ts >= cutoff;
      } catch {
        return false;
      }
    });
    if (recent.length > 0) {
      recurrenceContext = recent.join('\n');
    }
    // else: file exists but no recent events — keep "no recent recurrence data"
  }
}

// Catalog summary for Lens 4 (token limit guard — slugs + descriptions only)
function extractCatalogSlugs(catalogText) {
  const slugLines = [];
  const lines = catalogText.split('\n');
  for (const line of lines) {
    if (line.startsWith('### ') || line.startsWith('**Slug**')) {
      slugLines.push(line.replace(/^###\s+/, '').replace(/\*\*/g, '').trim());
    }
  }
  return slugLines.join('\n');
}
const catalogSlugs = antiPatternsText ? extractCatalogSlugs(antiPatternsText) : 'catalog unavailable';

// ── Lens prompt builders ─────────────────────────────────────────────────────

function buildLens1Prompt() {
  return `You are a technical risk analyst performing a pre-mortem on a software development wave spec.

Assume wave "${waveArg}" has already FAILED due to a technical or dependency issue.

Your task: identify the MOST LIKELY dependency, library, tooling, or environmental failure that caused it.

Wave spec:
${specText}

Anti-patterns catalog (for context on known failure patterns):
${antiPatternsText}

Respond with:
1. The primary failure scenario (1-2 sentences)
2. Root cause (specific dependency, tool, or technical assumption)
3. Early warning signs that would have been visible before the failure
4. Risk classification: likelihood (H/M/L), impact (H/M/L)

Be specific and adversarial. Generic answers ("something might break") are not acceptable.`;
}

function buildLens2Prompt() {
  return `You are a specification analyst performing a pre-mortem on a software development wave spec.

Assume wave "${waveArg}" has already FAILED due to an under-specification or missing requirement.

Your task: identify the MOST LIKELY thing that was under-specified in the spec and surfaced as a problem mid-implementation.

Wave spec:
${specText}

Anti-patterns catalog (for context on known failure patterns):
${antiPatternsText}

Respond with:
1. The primary failure scenario (1-2 sentences)
2. The specific missing or ambiguous element in the spec
3. How the ambiguity would have manifested during implementation
4. Risk classification: likelihood (H/M/L), impact (H/M/L)

Be specific. Identify the exact section or AC that has the ambiguity.`;
}

function buildLens3Prompt() {
  return `You are an integration risk analyst performing a pre-mortem on a software development wave spec.

Assume wave "${waveArg}" has already FAILED because it broke an existing system.

Your task: identify which existing system (script, hook, agent, checklist, config file, or JSONL stream) was broken by this wave's outputs.

Wave spec:
${specText}

Anti-patterns catalog (for context on known failure patterns):
${antiPatternsText}

Respond with:
1. The primary failure scenario (1-2 sentences)
2. Which existing system broke and why (file path if possible)
3. The integration assumption that was violated
4. Risk classification: likelihood (H/M/L), impact (H/M/L)

Be specific about which existing files or systems are at risk. Reference the wave's Component inventory if relevant.`;
}

function buildLens4Prompt() {
  return `You are an anti-pattern recurrence analyst performing a pre-mortem on a software development wave spec.

Assume wave "${waveArg}" has already FAILED by repeating a catalogued anti-pattern.

Your task: identify which of the 9 catalogued anti-patterns is MOST LIKELY to recur in this wave.

Wave spec:
${specText}

Catalogued anti-pattern slugs:
${catalogSlugs}

Last 24h recurrence events (from docs/audits/recurrence-events.jsonl):
${recurrenceContext}

Respond with:
1. The anti-pattern slug most likely to recur
2. The specific mechanism by which it would manifest in this wave
3. What in the spec or process increases this risk
4. Risk classification: likelihood (H/M/L), impact (H/M/L)

If recurrence events show a pattern already trending, weight that heavily in your analysis.`;
}

function buildSynthesisPrompt(lens1Out, lens2Out, lens3Out, lens4Out) {
  return `You are a risk synthesis analyst. You have received 4 independent adversarial pre-mortem analyses for wave "${waveArg}".

Your task: group these analyses into 3-5 ATAM risk themes. For each theme provide:
- theme: short failure class name (e.g. "dependency-version-mismatch", "scope-underspecified")
- likelihood: H (high), M (medium), or L (low)
- impact: H (high), M (medium), or L (low)
- mitigation: actionable recommendation (non-empty)
- source_lens: which lens(es) contributed (Lens 1, Lens 2, Lens 3, Lens 4)

Wave: ${waveArg}

--- LENS 1 (Technical/Dependency) ---
${lens1Out}

--- LENS 2 (Scope/Missing) ---
${lens2Out}

--- LENS 3 (Integration) ---
${lens3Out}

--- LENS 4 (Anti-pattern Recurrence) ---
${lens4Out}

Output ONLY a Markdown table with exactly these columns, followed by a brief paragraph summary:

| theme | likelihood | impact | mitigation | source_lens |
|-------|-----------|--------|------------|-------------|

Rules:
- 3-5 rows minimum. If fewer than 3 distinct themes exist, consolidate but note the WARN.
- Each mitigation field must be non-empty.
- No theme duplication across rows.
- Order by risk score (H/H first, L/L last).`;
}

// ── Dry-run mode ─────────────────────────────────────────────────────────────

if (isDry) {
  process.stdout.write(`[premortem] DRY RUN — wave=${waveArg} model=${MODEL}\n\n`);
  process.stdout.write('='.repeat(60) + '\n');
  process.stdout.write('Lens 1 (Technical/Dependency) prompt:\n');
  process.stdout.write(buildLens1Prompt().substring(0, 200) + '...\n\n');
  process.stdout.write('Lens 2 (Scope/Missing) prompt:\n');
  process.stdout.write(buildLens2Prompt().substring(0, 200) + '...\n\n');
  process.stdout.write('Lens 3 (Integration) prompt:\n');
  process.stdout.write(buildLens3Prompt().substring(0, 200) + '...\n\n');
  process.stdout.write('Lens 4 (Anti-pattern Recurrence) prompt:\n');
  process.stdout.write(buildLens4Prompt().substring(0, 200) + '...\n\n');
  process.stdout.write('Synthesis prompt (built after 4 lens outputs received):\n');
  process.stdout.write('[synthesis prompt built after all 4 lenses complete — Klein independence principle]\n\n');
  process.stdout.write('='.repeat(60) + '\n');
  process.stdout.write(`[premortem] DRY RUN COMPLETE — no files written, no LLM calls made.\n`);
  process.stdout.write(`[premortem] Run without --dry to execute full pre-mortem.\n`);
  process.exit(0);
}

// ── LLM subprocess invoker ───────────────────────────────────────────────────

/**
 * Invoke npx claude --print with a prompt via stdin.
 * Returns a Promise resolving to { ok: boolean, stdout: string, stderr: string }.
 * Pattern mirrors scripts/dispatch-parallel-implementations.mjs:233.
 */
function invokeClaude(prompt, lensLabel) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    process.stderr.write(`[premortem] DISPATCH ${lensLabel} (${MODEL})\n`);

    let stdout = '';
    let stderr = '';

    const child = spawn('npx', ['claude', '--print', '--model', MODEL], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write prompt to stdin
    child.stdin.write(prompt, 'utf8');
    child.stdin.end();

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (code !== 0) {
        process.stderr.write(`[premortem] WARN — ${lensLabel} exited non-zero (code=${code}) in ${elapsed}s. Using partial output.\n`);
        if (stderr.trim()) {
          process.stderr.write(`[premortem] ${lensLabel} stderr: ${stderr.trim().substring(0, 300)}\n`);
        }
        resolve({ ok: false, stdout: stdout.trim() || `[${lensLabel} failed — no output]`, stderr });
      } else {
        process.stderr.write(`[premortem] DONE ${lensLabel} (${elapsed}s)\n`);
        resolve({ ok: true, stdout: stdout.trim(), stderr });
      }
    });

    child.on('error', (err) => {
      process.stderr.write(`[premortem] ERROR spawning ${lensLabel}: ${err.message}\n`);
      resolve({ ok: false, stdout: `[${lensLabel} spawn error: ${err.message}]`, stderr: '' });
    });
  });
}

// ── 4-lens parallel dispatch (A2, A11) ──────────────────────────────────────

/**
 * Dispatch all 4 lenses in parallel (spawned before any await).
 * Klein independence: all 4 scenarios generated before synthesis.
 * Returns array of 4 outputs in order [lens1, lens2, lens3, lens4].
 */
async function dispatchLenses() {
  process.stderr.write(`[premortem] Dispatching 4 lens calls in parallel (Klein independence)...\n`);
  const dispatchStart = Date.now();

  // Spawn all 4 BEFORE any await — this is the parallel guarantee (A11)
  const p1 = invokeClaude(buildLens1Prompt(), 'Lens 1 (Technical/Dependency)');
  const p2 = invokeClaude(buildLens2Prompt(), 'Lens 2 (Scope/Missing)');
  const p3 = invokeClaude(buildLens3Prompt(), 'Lens 3 (Integration)');
  const p4 = invokeClaude(buildLens4Prompt(), 'Lens 4 (Anti-pattern Recurrence)');

  // Wait for all 4 (A3 enforced: synthesis call comes after this)
  const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);

  const totalMs = Date.now() - dispatchStart;
  process.stderr.write(`[premortem] All 4 lenses complete in ${Math.round(totalMs / 1000)}s\n`);

  return [r1.stdout, r2.stdout, r3.stdout, r4.stdout];
}

// ── Synthesis call (A3) ──────────────────────────────────────────────────────

/**
 * Run 1 synthesis call AFTER all 4 lens outputs received.
 * Groups lens outputs into 3-5 ATAM risk themes.
 */
async function runSynthesis(lens1Out, lens2Out, lens3Out, lens4Out) {
  process.stderr.write(`[premortem] Dispatching synthesis call...\n`);
  const synthStart = Date.now();

  const result = await invokeClaude(
    buildSynthesisPrompt(lens1Out, lens2Out, lens3Out, lens4Out),
    'Synthesis'
  );

  const elapsed = Math.round((Date.now() - synthStart) / 1000);
  process.stderr.write(`[premortem] Synthesis complete in ${elapsed}s\n`);

  return result.stdout;
}

// ── Parse synthesis output ───────────────────────────────────────────────────

/**
 * Parse risk theme rows from synthesis Markdown table output.
 * Returns array of { theme, likelihood, impact, mitigation, source_lens } objects.
 */
function parseRiskThemes(synthesisText) {
  const themes = [];
  const lines = synthesisText.split('\n');
  let inTable = false;

  for (const line of lines) {
    // Detect table header row
    if (line.includes('| theme') || line.includes('|theme')) {
      inTable = true;
      continue;
    }
    // Skip separator row
    if (inTable && line.match(/^\|[\s-|]+\|$/)) {
      continue;
    }
    // Parse data row
    if (inTable && line.startsWith('|') && line.includes('|')) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 5) {
        themes.push({
          theme: cols[0],
          likelihood: cols[1],
          impact: cols[2],
          mitigation: cols[3],
          source_lens: cols[4],
        });
      }
      // Stop if we hit empty line or non-table content
    } else if (inTable && line.trim() && !line.startsWith('|')) {
      inTable = false;
    }
  }

  return themes;
}

// ── Write artifacts (A5, A6, A7) ─────────────────────────────────────────────

/**
 * Write risk assessment artifact, append to taxonomy, emit telemetry.
 */
async function writeArtifacts(waveId, themes, synthesisText) {
  // Ensure output directory exists (A5 + T5)
  if (!fs.existsSync(RISK_ASSESSMENTS_DIR)) {
    fs.mkdirSync(RISK_ASSESSMENTS_DIR, { recursive: true });
    process.stderr.write(`[premortem] Created directory: docs/quality/risk-assessments/\n`);
  }

  const generatedAt = new Date().toISOString();

  // Warn if fewer than 3 themes (A4)
  if (themes.length < 3) {
    process.stderr.write(`[premortem] WARN — synthesis produced ${themes.length} theme(s) (minimum 3 recommended). Writing artifact with available themes.\n`);
  }

  // Build risk themes table
  const tableHeader = '| theme | likelihood | impact | mitigation | source_lens |\n|-------|-----------|--------|------------|-------------|';
  const tableRows = themes.map(t =>
    `| ${t.theme} | ${t.likelihood} | ${t.impact} | ${t.mitigation} | ${t.source_lens} |`
  ).join('\n');

  const artifactContent = `---
wave: ${waveId}
generated_at: ${generatedAt}
lenses: 4
llm_model: ${MODEL}
---

# Pre-Mortem Risk Assessment — ${waveId}

Generated by \`scripts/run-premortem.mjs\` (wave-156 Pre-Mortem Agent).
Article 9 artifact per EU AI Act risk management system.

## Risk Themes

${tableHeader}
${tableRows}

## Synthesis Notes

${synthesisText}

---

*Generated at ${generatedAt} by ${MODEL} via 4-lens parallel dispatch + synthesis.*
*Lens architecture: Technical/Dependency | Scope/Missing | Integration | Anti-pattern Recurrence*
`;

  // Write artifact atomically (.tmp then rename — STRIDE mitigation)
  const artifactPath = path.join(RISK_ASSESSMENTS_DIR, `${waveId}.md`);
  const tmpPath = artifactPath + '.tmp';
  fs.writeFileSync(tmpPath, artifactContent, 'utf8');
  fs.renameSync(tmpPath, artifactPath);
  process.stdout.write(`[premortem] Artifact written: docs/quality/risk-assessments/${waveId}.md\n`);

  // Append to taxonomy (A6, T7) — append-only, create if not exists
  const today = generatedAt.substring(0, 10);
  const taxonomyHeader = '# Pre-Mortem Risk Taxonomy\n\n> Append-only cross-wave failure taxonomy. Updated on each run.\n> Wave-156 v1. Compaction is a v2 concern.\n> Keyed by failure class: integration / scope / dependency / assumption / timing / anti-pattern\n\n| wave | date | theme | likelihood | impact | source_lens |\n|------|------|-------|-----------|--------|-------------|';

  if (!fs.existsSync(TAXONOMY_PATH)) {
    fs.writeFileSync(TAXONOMY_PATH, taxonomyHeader + '\n', 'utf8');
    process.stderr.write(`[premortem] Created taxonomy file: docs/quality/risk-assessments/_TAXONOMY.md\n`);
  }

  const taxonomyRows = themes.map(t =>
    `| ${waveId} | ${today} | ${t.theme} | ${t.likelihood} | ${t.impact} | ${t.source_lens} |`
  ).join('\n');

  fs.appendFileSync(TAXONOMY_PATH, taxonomyRows + '\n', 'utf8');
  process.stdout.write(`[premortem] Taxonomy updated: docs/quality/risk-assessments/_TAXONOMY.md (${themes.length} rows appended)\n`);

  // Emit telemetry event (A7, T8)
  const top3 = themes.slice(0, 3).map(t => t.theme);
  emitTelemetry('pre_mortem_run', {
    source: 'scripts/run-premortem.mjs',
    wave: waveId,
    agent: 'pre-mortem-agent',
    verdict: themes.length >= 3 ? 'PASS' : 'WARN',
    payload: {
      lens_count: 4,
      total_themes: themes.length,
      top_3_themes: top3,
      model: MODEL,
      artifact_path: `docs/quality/risk-assessments/${waveId}.md`,
    },
  });
  process.stdout.write(`[premortem] Telemetry emitted: pre_mortem_run event to docs/audits/agent-events.jsonl\n`);

  return { artifactPath, themesCount: themes.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

process.stderr.write(`[premortem] Starting pre-mortem for ${waveArg} (model=${MODEL})\n`);
process.stderr.write(`[premortem] Spec: docs/specs/${waveArg}_MASTER_SPEC.md\n`);

try {
  // Step 1: Dispatch 4 lenses in parallel (A2, A11)
  const [lens1Out, lens2Out, lens3Out, lens4Out] = await dispatchLenses();

  // Step 2: Synthesis — AFTER all 4 lenses (A3)
  const synthesisText = await runSynthesis(lens1Out, lens2Out, lens3Out, lens4Out);

  // Step 3: Parse themes from synthesis output
  let themes = parseRiskThemes(synthesisText);

  // Fallback: if table parsing failed, create minimal placeholder themes from raw text
  if (themes.length === 0) {
    process.stderr.write('[premortem] WARN — could not parse risk themes table from synthesis output. Using fallback.\n');
    themes = [
      { theme: 'unparsed-synthesis', likelihood: 'M', impact: 'M', mitigation: 'Review synthesis output manually', source_lens: 'Synthesis' },
    ];
  }

  // Step 4: Write artifacts (A5, A6, A7)
  const { themesCount } = await writeArtifacts(waveArg, themes, synthesisText);

  process.stdout.write(`\n[premortem] COMPLETE — wave=${waveArg} themes=${themesCount} artifact=docs/quality/risk-assessments/${waveArg}.md\n`);
  process.exit(0);
} catch (err) {
  process.stderr.write(`[premortem] UNHANDLED ERROR: ${err.message}\n`);
  if (err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  process.exit(1);
}
