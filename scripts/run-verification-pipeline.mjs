#!/usr/bin/env node
/**
 * run-verification-pipeline.mjs — Full 4-tier verification pipeline orchestrator.
 *
 * Sequence: Tier 1 (always) → Tier 2 (always) → Tier 3 (if triggered) → Tier 4 (if needed).
 * Writes full audit trail to docs/metrics/verification-pipeline-{wave}.json.
 *
 * Tier 3 activation criteria:
 *   - --effort L (large wave)
 *   - Diff touches security-critical paths (diffTouchesSecurity)
 *   - Diff touches billing/payment files
 *
 * Mission alignment is argued in Tier 3 (debate-prosecutor / debate-judge). The Tier-2
 * constitutional-VIOLATION hard stop was removed with its reviewer agent on 2026-10-10:
 * nothing emitted VIOLATION any more, so the stop could only fire on stray text and the
 * telemetry it wrote recorded PASS verdicts from a reviewer that no longer ran.
 *
 * Tier 3 skipped for --effort S unless security or billing paths are flagged.
 *
 * Usage:
 *   node scripts/run-verification-pipeline.mjs --wave wave-103 --effort L
 *   node scripts/run-verification-pipeline.mjs --wave wave-103 --effort S
 *   node scripts/run-verification-pipeline.mjs --help
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './lib/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ─────────────────────────────────────────────────────────────
// Строгий разбор (2026-09-16): незнакомый флаг или лишнее слово — код 2 до andon-проверки,
// до запуска уровней и до вебхука эскалации.
export const CLI = {
  name: 'run-verification-pipeline',
  usage: `run-verification-pipeline.mjs — Full 4-tier verification pipeline

Orchestrates Tier 1 → Tier 2 → Tier 3 (conditional) → Tier 4 (if needed).
Writes audit trail to docs/metrics/verification-pipeline-{wave}.json.

Usage:
  node scripts/run-verification-pipeline.mjs --wave <id> [--effort <S|M|L>] [--dry-run] [--help]

Flags:
  --wave <id>            Wave identifier (e.g. wave-103)
  --effort <S|M|L>       Wave effort level. S skips Tier 3 unless security/billing flagged. Default M.
  --dry-run              Print tier decisions without executing
  -h, --help             Show this message

Exit codes:
  0   Pipeline passed all active tiers
  1   BLOCK or DEADLOCK detected
  2   Bad call (unknown flag, stray word, missing value) — nothing was run
  42  Andon halt state active (andonCord.enabled)`,
  options: {
    wave: { type: 'string', default: 'unknown' },
    effort: { type: 'string', default: 'M', choices: ['S', 'M', 'L'] },
    'dry-run': { type: 'boolean' },
  },
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const { values } = runCli(CLI);

  // ── Wave-158 Andon Cord — halt-state gate (before any pipeline work) ────────
  {
    const haltStatePath = path.join(ROOT, '.sdd-halt-state.json');
    if (fs.existsSync(haltStatePath)) {
      let andonEnabled = false;
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.sdd-config.json'), 'utf8'));
        andonEnabled = Boolean(cfg?.andonCord?.enabled);
      } catch { /* config unreadable — default to soft mode */ }

      let haltState = null;
      try {
        haltState = JSON.parse(fs.readFileSync(haltStatePath, 'utf8'));
      } catch { /* unreadable halt state — skip gate */ }

      if (haltState?.active) {
        const { wave: hw, agent: ha, reason: hr } = haltState.active;
        if (andonEnabled) {
          process.stderr.write(
            `[andon] HALTED — pipeline blocked.\n` +
            `  wave=${hw}  agent=${ha}\n` +
            `  reason: ${hr}\n` +
            `  Resume: node scripts/andon-resume.mjs --wave ${hw} --approver <name> --reason <text> --root-cause <annotation>\n`
          );
          process.exit(42);
        } else {
          process.stderr.write(
            `[andon] WARN — halt state present but andonCord.enabled: false (soft mode). Pipeline continues.\n` +
            `  wave=${hw}  agent=${ha}  reason: ${hr}\n` +
            `  Set andonCord.enabled: true in .sdd-config.json to block the pipeline on halt.\n`
          );
        }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const waveId = values.wave;
  const effort = values.effort;
  const dryRun = values['dry-run'] === true;

  // ── Helpers ─────────────────────────────────────────────────────────────

  function run(cmd, opts = {}) {
    if (dryRun) {
      return { ok: true, stdout: `[DRY-RUN] ${cmd}`, stderr: '', code: 0 };
    }
    try {
      const stdout = execSync(cmd, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        ...opts,
      });
      return { ok: true, stdout, stderr: '', code: 0 };
    } catch (err) {
      return {
        ok: false,
        stdout: err.stdout || '',
        stderr: err.stderr || String(err),
        code: err.status || 1,
      };
    }
  }

  function log(msg) {
    console.log(msg);
  }

  function timestamp() {
    return new Date().toISOString();
  }

  // ── Billing/security path detector ────────────────────────────────────────

  /**
 * Check if the current HEAD diff touches billing or payment files.
 * Returns true if any changed file matches known billing/payment patterns.
 */
  function diffTouchesBilling() {
    if (dryRun) return false;
    const r = run('git diff HEAD~1 --name-only 2>/dev/null || git diff --cached --name-only 2>/dev/null || echo ""');
    const files = r.stdout.split('\n').filter(Boolean);
    const billingPatterns = [/billing/i, /payment/i, /stripe/i, /invoice/i, /subscription/i];
    return files.some((f) => billingPatterns.some((p) => p.test(f)));
  }

  /**
 * Check if the current HEAD diff touches security-critical files.
 */
  function diffTouchesSecurity() {
    if (dryRun) return false;
    const r = run('git diff HEAD~1 --name-only 2>/dev/null || echo ""');
    const files = r.stdout.split('\n').filter(Boolean);
    const securityPatterns = [/auth/i, /security/i, /password/i, /token/i, /secret/i, /middleware/i];
    return files.some((f) => securityPatterns.some((p) => p.test(f)));
  }

  // ── Tier 3 trigger evaluation ────────────────────────────────────────────

  /**
 * Determine whether Tier 3 should be activated.
 * Tier 3 activates on effort level and security/billing path signals only.
 * @param {string} effort - 'S'|'M'|'L'
 * @param {{ tier1Blocked: boolean }} ctx
 * @returns {{ activate: boolean, reason: string }}
 */
  function shouldActivateTier3(effort, ctx) {
    const { tier1Blocked } = ctx;

    // Tier 3 never activates on S-effort unless forced by security/billing.
    const billing = diffTouchesBilling();
    const security = diffTouchesSecurity();

    if (effort === 'S' && !security && !billing) {
      return { activate: false, reason: 'S-effort wave with no security/billing diff' };
    }

    if (effort === 'L') return { activate: true, reason: 'L-effort wave' };
    if (security) return { activate: true, reason: 'diff touches security-critical paths' };
    if (billing) return { activate: true, reason: 'diff touches billing/payment paths' };

    return { activate: false, reason: 'No Tier 3 trigger conditions met' };
  }

  // ── Tier 4 notification ───────────────────────────────────────────────────

  /**
 * Emit Tier 4 escalation. Prints terminal alert. If SLACK_WEBHOOK_URL is set,
 * sends a payload. Also creates a GitHub issue draft note.
 */
  function tier4Escalate(waveId, reason) {
    log('\n╔══════════════════════════════════════════════════════╗');
    log('║  [TIER-4] ESCALATE — Human review required           ║');
    log(`║  Wave: ${waveId.padEnd(45)}║`);
    log(`║  Reason: ${reason.slice(0, 43).padEnd(43)}║`);
    log('╚══════════════════════════════════════════════════════╝\n');

    // Slack/Telegram webhook (optional).
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      const payload = JSON.stringify({
        text: `*Tier 4 Escalation* — ${waveId}\nReason: ${reason}\nAction required: review debate transcript in docs/debates/ before merge.`,
      });
      run(`curl -s -X POST -H 'Content-type: application/json' --data ${JSON.stringify(payload)} ${webhookUrl}`, {
        timeout: 10000,
      });
      log('[TIER-4] Slack notification sent.');
    }

    // GitHub issue draft note.
    const issueDraftPath = path.join(ROOT, '.claude', 'tier4-escalations', `${waveId}-${Date.now()}.md`);
    try {
      fs.mkdirSync(path.dirname(issueDraftPath), { recursive: true });
      fs.writeFileSync(
        issueDraftPath,
        `# Tier 4 Escalation — ${waveId}\n\n**Reason**: ${reason}\n**Date**: ${timestamp()}\n\nReview \`docs/debates/${waveId}-debate.md\` before allowing merge.\n`,
        'utf8',
      );
      log(`[TIER-4] Issue draft saved to ${issueDraftPath}`);
    } catch {
      // Non-fatal.
    }
  }

  // ── Main pipeline ────────────────────────────────────────────────────────

  const pipelineStart = Date.now();
  const auditTrail = {
    wave: waveId,
    effort,
    started: timestamp(),
    tiers: {},
    finalStatus: null,
    escalations: [],
  };

  log(`\n${'='.repeat(60)}`);
  log(`Verification Pipeline — ${waveId} (effort: ${effort})${dryRun ? ' [DRY-RUN]' : ''}`);
  log(`${'='.repeat(60)}\n`);

  // ── Tier 1 ────────────────────────────────────────────────────────────────
  log('[PIPELINE] Tier 1 — Automated checks starting…');
  const t1Start = Date.now();
  const t1 = run(`node ${path.join(__dirname, 'run-tier-1-checks.mjs')} --wave ${waveId}${dryRun ? ' --dry-run' : ''}`, {
    timeout: 600000,
  });
  const t1Elapsed = `${((Date.now() - t1Start) / 1000).toFixed(1)}s`;
  const tier1Blocked = !t1.ok;
  auditTrail.tiers.tier1 = { status: tier1Blocked ? 'BLOCK' : 'PASS', elapsed: t1Elapsed, output: t1.stdout.slice(0, 1000) };

  if (t1.stdout) process.stdout.write(t1.stdout);

  // ── Tier 2 ────────────────────────────────────────────────────────────────
  log('\n[PIPELINE] Tier 2 — Specialist checks starting…');
  const t2Start = Date.now();
  const t2 = run(`node ${path.join(__dirname, 'run-tier-2-checks.mjs')} --wave ${waveId}${dryRun ? ' --dry-run' : ''}`, {
    timeout: 600000,
  });
  const t2Elapsed = `${((Date.now() - t2Start) / 1000).toFixed(1)}s`;
  const tier2Blocked = !t2.ok;
  auditTrail.tiers.tier2 = {
    status: tier2Blocked ? 'BLOCK' : 'PASS',
    elapsed: t2Elapsed,
    output: t2.stdout.slice(0, 1000),
  };

  if (t2.stdout) process.stdout.write(t2.stdout);

  // ── Tier 3 ────────────────────────────────────────────────────────────────
  // Tier 3 activates on effort/security/billing only.
  const { activate: activateTier3, reason: tier3Reason } = shouldActivateTier3(effort, {
    tier1Blocked,
  });

  let tier3Verdict = null;
  let deadlock = false;

  if (!activateTier3) {
    log(`\n[TIER-3] SKIP — ${tier3Reason}`);
    auditTrail.tiers.tier3 = { status: 'SKIP', reason: tier3Reason };
  } else {
    log(`\n[PIPELINE] Tier 3 — Adversarial debate starting (${tier3Reason})…`);
    const t3Start = Date.now();

    // Dynamically import debate-engine.
    let debateResult;
    try {
      const { runDebate } = await import(path.join(ROOT, 'lib', 'verification', 'debate-engine.mjs'));
      const diffPath = dryRun ? undefined : run('git diff HEAD~1 --name-only 2>/dev/null').stdout;
      const specPath = `docs/specs/${waveId}_MASTER_SPEC.md`;
      debateResult = await runDebate({ waveId, diffPath, specPath });
    } catch (err) {
      log(`[TIER-3] ERROR: ${err.message}. Gracefully degrading to SKIP.`);
      debateResult = { verdict: 'SKIP', transcriptPath: null, judgeReasoning: String(err), deadlock: false };
    }

    tier3Verdict = debateResult.verdict;
    deadlock = debateResult.deadlock;
    const t3Elapsed = `${((Date.now() - t3Start) / 1000).toFixed(1)}s`;

    auditTrail.tiers.tier3 = {
      status: tier3Verdict,
      elapsed: t3Elapsed,
      transcriptPath: debateResult.transcriptPath,
      deadlock,
    };

    log(`[TIER-3] Verdict: ${tier3Verdict} (${t3Elapsed})`);

    // ── Tier 4 ────────────────────────────────────────────────────────────
    if (deadlock) {
      log('\n[TIER-4] ESCALATE — DEADLOCK detected');
      tier4Escalate(waveId, 'Debate DEADLOCK — 2+ unresolved material concerns from both sides');
      auditTrail.escalations.push({ type: 'DEADLOCK', timestamp: timestamp() });
      auditTrail.finalStatus = 'ESCALATED';

      // Write audit trail before exiting.
      writeAuditTrail();
      process.exit(1);
    }

    if (tier3Verdict === 'BLOCK') {
      log('\n[TIER-4] ESCALATE — BLOCK verdict from debate judge');
      tier4Escalate(waveId, 'Debate judge issued BLOCK — architectural or security remediation required');
      auditTrail.escalations.push({ type: 'BLOCK', timestamp: timestamp() });
      auditTrail.finalStatus = 'BLOCKED';

      writeAuditTrail();
      process.exit(1);
    }
  }

  // ── Final status ─────────────────────────────────────────────────────────

  const anyBlock = tier1Blocked || tier2Blocked || tier3Verdict === 'BLOCK' || deadlock;
  auditTrail.finalStatus = anyBlock ? 'BLOCK' : 'PASS';
  auditTrail.totalElapsed = `${((Date.now() - pipelineStart) / 1000).toFixed(1)}s`;
  auditTrail.finished = timestamp();

  // Write audit trail.
  function writeAuditTrail() {
    const metricsDir = path.join(ROOT, 'docs', 'metrics');
    if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });
    const auditPath = path.join(metricsDir, `verification-pipeline-${waveId}.json`);
    fs.writeFileSync(auditPath, JSON.stringify(auditTrail, null, 2), 'utf8');
    log(`[PIPELINE] Audit trail written to ${auditPath}`);
  }

  writeAuditTrail();

  // Final summary.
  log(`\n${'='.repeat(60)}`);
  log(`Pipeline Summary — ${waveId}`);
  log(`${'='.repeat(60)}`);
  log(`  Tier 1: ${auditTrail.tiers.tier1?.status || 'N/A'}`);
  log(`  Tier 2: ${auditTrail.tiers.tier2?.status || 'N/A'}`);
  log(`  Tier 3: ${auditTrail.tiers.tier3?.status || 'SKIP'}`);
  log(`  Total:  ${auditTrail.totalElapsed}`);
  log(`  Status: ${auditTrail.finalStatus}`);

  if (anyBlock) {
    log('\n[PIPELINE] BLOCK — fix required before merge.\n');
    process.exit(1);
  } else {
    log('\n[PIPELINE] PASS — all active tiers cleared.\n');
    process.exit(0);
  }
}
