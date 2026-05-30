#!/usr/bin/env node
// @ts-check
/**
 * Wave-164 — Eval Framework (Golden Dataset + Auto-Score)
 *
 * Reads docs/evals/{slug}/golden-cases.jsonl, runs deterministic + LLM-judge
 * layers per case, compares aggregate pass-rate vs eval-baseline.json, emits
 * eval_run and eval_regression_detected events to stream 11 (eval-events.jsonl).
 *
 * CLI flags:
 *   --agent <slug>       Evaluate a single agent (default: all discovered agents)
 *   --dry-run            No LLM calls, no file writes, exit 0
 *   --seed-baseline      Write current pass-rates to eval-baseline.json, exit 0 (no regression check)
 *
 * Exit codes:
 *   0 — PASS or dry-run or seed-baseline
 *   1 — REGRESSION DETECTED or usage error
 *
 * Stream: docs/audits/eval-events.jsonl (11th telemetry stream, wave-164 T3)
 * EU AI Act Art 15: task-completion rate declarable metric.
 *
 * invokeClaude() COPIED VERBATIM from scripts/run-premortem.mjs:309-352 (CARTO REUSE mandate).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Constants ────────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-6';
const EVALS_DIR = path.join(ROOT, 'docs', 'evals');
const EVAL_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'eval-events.jsonl');
const PASS_THRESHOLD = 0.7;
const REGRESSION_DROP_THRESHOLD = 0.05;
const MAX_CASES_PER_RUN = 200;

// ── CLI argument parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || args.includes('--dry');
const isSeedBaseline = args.includes('--seed-baseline');
const agentFlag = args.indexOf('--agent');
const targetAgent = agentFlag !== -1 ? args[agentFlag + 1] : null;

if (isDryRun) {
  process.stdout.write('[eval] DRY RUN — no LLM calls, no file writes.\n');
  process.stdout.write('[eval] Discovered agents:\n');
  const agentDirs = discoverAgents();
  for (const slug of agentDirs) {
    const casesPath = path.join(EVALS_DIR, slug, 'golden-cases.jsonl');
    const cases = readJsonlCases(casesPath);
    process.stdout.write(`  ${slug}: ${cases.length} cases found\n`);
  }
  process.stdout.write('[eval] DRY RUN COMPLETE — no files written, no LLM calls made.\n');
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const agentSlugs = targetAgent ? [targetAgent] : discoverAgents();

  if (agentSlugs.length === 0) {
    process.stderr.write('[eval] ERROR — no agent datasets found in docs/evals/. Run with --dry to verify setup.\n');
    process.exit(1);
  }

  let anyRegression = false;

  for (const slug of agentSlugs) {
    process.stdout.write(`\n[eval] === Evaluating agent: ${slug} ===\n`);

    const casesPath = path.join(EVALS_DIR, slug, 'golden-cases.jsonl');
    const baselinePath = path.join(EVALS_DIR, slug, 'eval-baseline.json');

    if (!fs.existsSync(casesPath)) {
      process.stderr.write(`[eval] WARN — golden-cases.jsonl not found for ${slug}. Skipping.\n`);
      continue;
    }

    let cases = readJsonlCases(casesPath);

    // STRIDE §11: hard-cap at 200 cases per agent per run
    if (cases.length > MAX_CASES_PER_RUN) {
      process.stderr.write(`[eval] WARN — ${slug} has ${cases.length} cases, capped at ${MAX_CASES_PER_RUN}.\n`);
      cases = cases.slice(0, MAX_CASES_PER_RUN);
    }

    // Staleness check
    checkDatasetStaleness(cases, slug);

    const runId = crypto.randomUUID();
    const results = [];

    for (const evalCase of cases) {
      process.stdout.write(`[eval] Case ${evalCase.case_id}...\n`);
      const result = await evaluateCase(evalCase);
      results.push(result);
    }

    const casesPass = results.filter(r => r.final_pass).length;
    const passRate = cases.length > 0 ? casesPass / cases.length : 0;

    process.stdout.write(`[eval] ${slug}: ${casesPass}/${cases.length} passed (${Math.round(passRate * 100)}%)\n`);

    // Load baseline (if exists)
    const baseline = loadBaseline(baselinePath);
    const baselineRate = baseline ? baseline.pass_rate : null;

    // Seed-baseline mode: write and skip regression check
    if (isSeedBaseline) {
      const casePassMap = {};
      for (let i = 0; i < cases.length; i++) {
        casePassMap[cases[i].case_id] = results[i].final_pass;
      }
      const newBaseline = {
        agent_slug: slug,
        pass_rate: passRate,
        case_pass_map: casePassMap,
        seeded_at: new Date().toISOString(),
        seed_mode: 'live',
      };
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, JSON.stringify(newBaseline, null, 2) + '\n', 'utf8');
      process.stdout.write(`[eval] Baseline seeded for ${slug}: pass_rate=${Math.round(passRate * 100)}%\n`);

      emitEvalRun({ runId, slug, casesTotal: cases.length, casesPass, passRate, baselineRate: null, regression: false, seedMode: true });
      continue;
    }

    // Regression detection (T5: BOTH relative AND absolute)
    let regression = false;

    if (baseline !== null) {
      // Condition 1 — Aggregate pass-rate drop
      if (baselineRate !== null && passRate < baselineRate - REGRESSION_DROP_THRESHOLD) {
        process.stderr.write(
          `[eval] REGRESSION — ${slug}: pass_rate dropped from ${Math.round((baselineRate || 0) * 100)}% to ${Math.round(passRate * 100)}% ` +
          `(threshold: ${REGRESSION_DROP_THRESHOLD * 100}pp absolute)\n`
        );
        regression = true;
      }

      // Condition 2 — Case-level absolute regression
      const baselineCaseMap = baseline.case_pass_map || {};
      for (let i = 0; i < cases.length; i++) {
        const caseId = cases[i].case_id;
        const wasPass = baselineCaseMap[caseId];
        const isPass = results[i].final_pass;
        if (wasPass === true && isPass === false) {
          process.stderr.write(`[eval] REGRESSION — ${slug}: case ${caseId} was passing in baseline, now fails.\n`);
          regression = true;
        }
      }
    } else {
      process.stdout.write(`[eval] No baseline found for ${slug}. Run with --seed-baseline to establish baseline.\n`);
    }

    // Emit eval_run event
    emitEvalRun({ runId, slug, casesTotal: cases.length, casesPass, passRate, baselineRate, regression, seedMode: false });

    if (regression) {
      emitEvalRegressionDetected({ runId, slug, passRate, baselineRate: baselineRate ?? 0 });
      anyRegression = true;
    }
  }

  if (anyRegression) {
    process.stderr.write('\n[eval] REGRESSION DETECTED — exiting non-zero. Human review required.\n');
    process.exit(1);
  }

  process.stdout.write('\n[eval] PASS — all agents within baseline thresholds.\n');
  process.exit(0);
})();

// ── Agent discovery ───────────────────────────────────────────────────────────

/**
 * Scan docs/evals/ for subdirectories that contain golden-cases.jsonl.
 * @returns {string[]} Array of agent slugs.
 */
function discoverAgents() {
  if (!fs.existsSync(EVALS_DIR)) return [];
  return fs.readdirSync(EVALS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => fs.existsSync(path.join(EVALS_DIR, name, 'golden-cases.jsonl')));
}

// ── JSONL reader ─────────────────────────────────────────────────────────────

/**
 * Read and parse golden-cases.jsonl. Filters blank lines. Returns parsed records.
 * @param {string} filePath
 * @returns {import('../lib/types/eval.ts').EvalCase[]}
 */
function readJsonlCases(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      process.stderr.write(`[eval] WARN — failed to parse JSON line in ${filePath}: ${trimmed.substring(0, 80)}\n`);
    }
  }
  return records;
}

// ── Staleness check ───────────────────────────────────────────────────────────

/**
 * Check dataset staleness per docs/evals/scoring-rubric.md §5.
 * @param {import('../lib/types/eval.ts').EvalCase[]} cases
 * @param {string} slug
 */
function checkDatasetStaleness(cases, slug) {
  const now = new Date();
  for (const c of cases) {
    const curated = c.metadata?.last_curated;
    if (!curated) continue;
    const ageMs = now - new Date(curated);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 180) {
      process.stderr.write(`[eval] WARN — ${slug} case ${c.case_id}: last_curated is ${Math.round(ageDays)} days ago (>180 days). Dataset is stale.\n`);
    } else if (ageDays > 90) {
      process.stderr.write(`[eval] WARN — ${slug} case ${c.case_id}: last_curated is ${Math.round(ageDays)} days ago (>90 days).\n`);
    }
  }
}

// ── Baseline I/O ──────────────────────────────────────────────────────────────

/**
 * Load eval-baseline.json or return null if absent.
 * @param {string} baselinePath
 * @returns {{ pass_rate: number, case_pass_map: Record<string, boolean> } | null}
 */
function loadBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch {
    process.stderr.write(`[eval] WARN — failed to parse baseline at ${baselinePath}. Treating as absent.\n`);
    return null;
  }
}

// ── Per-case evaluation ───────────────────────────────────────────────────────

/**
 * Evaluate a single EvalCase through deterministic + LLM-judge layers.
 * @param {import('../lib/types/eval.ts').EvalCase} evalCase
 * @returns {Promise<import('../lib/types/eval.ts').EvalResult>}
 */
async function evaluateCase(evalCase) {
  // Layer 1: Deterministic checks
  const deterministicPass = runDeterministicChecks(evalCase);

  if (!deterministicPass) {
    return {
      case_id: evalCase.case_id,
      deterministic_pass: false,
      judge_verdict: 'fail',
      final_pass: false,
    };
  }

  // Layer 2: LLM swap-and-compare judge
  const judgement = await runSwapAndCompareJudge(evalCase);

  const finalPass = judgement.verdict === 'pass' || judgement.verdict === 'tie';

  return {
    case_id: evalCase.case_id,
    deterministic_pass: true,
    judge_verdict: judgement.verdict,
    final_pass: finalPass,
  };
}

// ── Deterministic layer ───────────────────────────────────────────────────────

/**
 * Layer 1 deterministic checks (schema, non-empty fields, agent_slug match).
 * @param {import('../lib/types/eval.ts').EvalCase} evalCase
 * @returns {boolean}
 */
function runDeterministicChecks(evalCase) {
  if (!evalCase.case_id || typeof evalCase.case_id !== 'string') {
    process.stderr.write(`[eval] WARN — case missing case_id.\n`);
    return false;
  }
  if (!evalCase.input || typeof evalCase.input !== 'string' || !evalCase.input.trim()) {
    process.stderr.write(`[eval] WARN — case ${evalCase.case_id} has empty input.\n`);
    return false;
  }
  if (!evalCase.expected_output || typeof evalCase.expected_output !== 'string' || !evalCase.expected_output.trim()) {
    process.stderr.write(`[eval] WARN — case ${evalCase.case_id} has empty expected_output.\n`);
    return false;
  }
  return true;
}

// ── LLM-judge swap-and-compare ────────────────────────────────────────────────

/**
 * Run swap-and-compare LLM judge for a single case.
 * Calls invokeClaude() twice (A-vs-B then B-vs-A).
 * TIE if scores disagree across the PASS_THRESHOLD boundary.
 *
 * @param {import('../lib/types/eval.ts').EvalCase} evalCase
 * @returns {Promise<import('../lib/types/eval.ts').EvalJudgement>}
 */
async function runSwapAndCompareJudge(evalCase) {
  const promptA = buildJudgePrompt(evalCase.agent_slug, evalCase.input, evalCase.expected_output);
  // Swap: expected_output in INPUT slot, input in EXPECTED slot
  const promptB = buildJudgePromptSwap(evalCase.agent_slug, evalCase.expected_output, evalCase.input);

  const [resultA, resultB] = await Promise.all([
    invokeClaude(promptA, `judge-A:${evalCase.case_id}`),
    invokeClaude(promptB, `judge-B:${evalCase.case_id}`),
  ]);

  const score_A = parseJudgeScore(resultA.stdout);
  const score_B = parseJudgeScore(resultB.stdout);

  // Agreement check: both must be on the same side of PASS_THRESHOLD
  const passA = score_A >= PASS_THRESHOLD;
  const passB = score_B >= PASS_THRESHOLD;

  let verdict;
  if (passA && passB) {
    verdict = 'pass';
  } else if (!passA && !passB) {
    verdict = 'fail';
  } else {
    // Disagreement: position-bias TIE (Zheng 2023)
    verdict = 'tie';
  }

  const reasoning = extractJudgeReasoning(resultA.stdout) || 'No reasoning extracted.';

  return { case_id: evalCase.case_id, score_A, score_B, verdict, reasoning };
}

/**
 * Build judge prompt A (natural order: input -> expected).
 * @param {string} agentSlug
 * @param {string} input
 * @param {string} expected
 * @returns {string}
 */
function buildJudgePrompt(agentSlug, input, expected) {
  return `You are evaluating whether an AI agent named ${agentSlug} completed a task correctly.

## Task input presented to the agent
${input}

## Expected output (what a correct response looks like)
${expected}

## Your task
Score this case on a scale of 0.0 to 1.0 where:
- 1.0 = the agent output matches the expected output in substance (minor phrasing differences acceptable)
- 0.7 = the agent output is substantially correct but missing one minor element
- 0.5 = the agent output is partially correct (correct intent, incomplete execution)
- 0.3 = the agent output shows relevant understanding but fails on the core task
- 0.0 = the agent output is incorrect, irrelevant, or empty

Return ONLY a JSON object with this exact shape:
{"score": <number 0.0-1.0>, "reasoning": "<one sentence>"}`;
}

/**
 * Build judge prompt B (swap: expected in INPUT slot, input in EXPECTED slot).
 * Position-bias mitigation per Zheng 2023.
 * @param {string} agentSlug
 * @param {string} slotA - what was expected_output (now in "input" slot)
 * @param {string} slotB - what was input (now in "expected" slot)
 * @returns {string}
 */
function buildJudgePromptSwap(agentSlug, slotA, slotB) {
  return `You are evaluating whether an AI agent named ${agentSlug} completed a task correctly.

## Task input presented to the agent
${slotA}

## Expected output (what a correct response looks like)
${slotB}

## Your task
Score this case on a scale of 0.0 to 1.0 where:
- 1.0 = the agent output matches the expected output in substance (minor phrasing differences acceptable)
- 0.7 = the agent output is substantially correct but missing one minor element
- 0.5 = the agent output is partially correct (correct intent, incomplete execution)
- 0.3 = the agent output shows relevant understanding but fails on the core task
- 0.0 = the agent output is incorrect, irrelevant, or empty

Return ONLY a JSON object with this exact shape:
{"score": <number 0.0-1.0>, "reasoning": "<one sentence>"}`;
}

/**
 * Parse a numeric score from the judge's JSON output.
 * Falls back to 0.5 (TIE-safe) on parse failure.
 * @param {string} output
 * @returns {number}
 */
function parseJudgeScore(output) {
  try {
    const match = output.match(/\{[^}]*"score"\s*:\s*([\d.]+)[^}]*\}/);
    if (match) {
      const score = parseFloat(match[1]);
      if (!isNaN(score) && score >= 0 && score <= 1) return score;
    }
    // Try full JSON parse
    const parsed = JSON.parse(output.trim());
    if (typeof parsed.score === 'number') return Math.max(0, Math.min(1, parsed.score));
  } catch {
    // Fall through
  }
  process.stderr.write(`[eval] WARN — could not parse judge score from output: ${output.substring(0, 100)}\n`);
  return 0.5; // TIE-safe default on parse failure
}

/**
 * Extract reasoning string from judge JSON output.
 * @param {string} output
 * @returns {string | null}
 */
function extractJudgeReasoning(output) {
  try {
    const parsed = JSON.parse(output.trim());
    if (typeof parsed.reasoning === 'string') return parsed.reasoning;
  } catch {
    const match = output.match(/"reasoning"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
  }
  return null;
}

// ── Stream 11 emit helpers ───────────────────────────────────────────────────

/**
 * Emit an eval_run event to docs/audits/eval-events.jsonl (stream 11).
 * @param {{ runId: string, slug: string, casesTotal: number, casesPass: number, passRate: number, baselineRate: number | null, regression: boolean, seedMode: boolean }} params
 */
function emitEvalRun({ runId, slug, casesTotal, casesPass, passRate, baselineRate, regression, seedMode }) {
  const event = {
    schema_version: '1',
    id: crypto.randomUUID(),
    source: 'scripts/run-evals.mjs',
    specversion: '1.0',
    type: 'io.app.eval_run',
    time: new Date().toISOString(),
    trace_id: crypto.randomUUID(),
    span_id: crypto.randomUUID(),
    parent_span_id: null,
    wave: 'wave-164',
    agent: slug,
    event_type: 'eval_run',
    verdict: regression ? 'REGRESSION' : 'PASS',
    payload: {
      run_id: runId,
      agent_slug: slug,
      cases_total: casesTotal,
      cases_pass: casesPass,
      pass_rate: passRate,
      baseline_rate: baselineRate,
      regression,
      seed: seedMode,
    },
    compliance_ref: 'EU AI Act Art 15',
    prev_hash: null,
  };
  appendToStream(EVAL_EVENTS_PATH, event);
}

/**
 * Emit an eval_regression_detected event to stream 11.
 * @param {{ runId: string, slug: string, passRate: number, baselineRate: number }} params
 */
function emitEvalRegressionDetected({ runId, slug, passRate, baselineRate }) {
  const event = {
    schema_version: '1',
    id: crypto.randomUUID(),
    source: 'scripts/run-evals.mjs',
    specversion: '1.0',
    type: 'io.app.eval_regression_detected',
    time: new Date().toISOString(),
    trace_id: crypto.randomUUID(),
    span_id: crypto.randomUUID(),
    parent_span_id: null,
    wave: 'wave-164',
    agent: slug,
    event_type: 'eval_regression_detected',
    verdict: 'REGRESSION_DETECTED',
    payload: {
      run_id: runId,
      agent_slug: slug,
      pass_rate: passRate,
      baseline_rate: baselineRate,
      drop: baselineRate - passRate,
    },
    compliance_ref: 'EU AI Act Art 15 — SLO-7 budget_7d: 0',
    prev_hash: null,
  };
  appendToStream(EVAL_EVENTS_PATH, event);
}

/**
 * Append a JSON record to a JSONL file. Creates directory if absent. Non-fatal on error.
 * @param {string} filePath
 * @param {object} record
 */
function appendToStream(filePath, record) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`[eval] ERROR — failed to write to ${filePath}: ${err}\n`);
  }
}

// ── LLM subprocess invoker ───────────────────────────────────────────────────

/**
 * Invoke npx claude --print with a prompt via stdin.
 * Returns a Promise resolving to { ok: boolean, stdout: string, stderr: string }.
 * COPIED VERBATIM from scripts/run-premortem.mjs:309-352 (CARTO REUSE mandate).
 */
function invokeClaude(prompt, judgeLabel) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    process.stderr.write(`[eval] DISPATCH ${judgeLabel} (${MODEL})\n`);

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
        process.stderr.write(`[eval] WARN — ${judgeLabel} exited non-zero (code=${code}) in ${elapsed}s. Using partial output.\n`);
        if (stderr.trim()) {
          process.stderr.write(`[eval] ${judgeLabel} stderr: ${stderr.trim().substring(0, 300)}\n`);
        }
        resolve({ ok: false, stdout: stdout.trim() || `[${judgeLabel} failed — no output]`, stderr });
      } else {
        process.stderr.write(`[eval] DONE ${judgeLabel} (${elapsed}s)\n`);
        resolve({ ok: true, stdout: stdout.trim(), stderr });
      }
    });

    child.on('error', (err) => {
      process.stderr.write(`[eval] ERROR spawning ${judgeLabel}: ${err.message}\n`);
      resolve({ ok: false, stdout: `[${judgeLabel} spawn error: ${err.message}]`, stderr: '' });
    });
  });
}
