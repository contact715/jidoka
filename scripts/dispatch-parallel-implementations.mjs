#!/usr/bin/env node
/**
 * dispatch-parallel-implementations.mjs — Parallel best-of-N branch dispatcher.
 *
 * Creates N git branches (via git worktree) for parallel implementation attempts
 * of the same spec. After all N attempts complete, --collect mode invokes the
 * best-of-N-judge for comparison and writes results to docs/debates/.
 *
 * Uses git worktree to avoid stashing conflicts (preferred over sequential
 * checkout per wave-103 open question resolution).
 *
 * Usage:
 *   node scripts/dispatch-parallel-implementations.mjs --n 3 --wave wave-103 --spec docs/specs/wave-103_MASTER_SPEC.md
 *   node scripts/dispatch-parallel-implementations.mjs --wave wave-103 --collect
 *   node scripts/dispatch-parallel-implementations.mjs --help
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistArtifact } from './reasoning-bank.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
dispatch-parallel-implementations.mjs — Best-of-N parallel implementation dispatcher

Creates N git branches via git worktree for parallel implementations. After all
N attempts complete, --collect mode runs best-of-N-judge for comparison.

Usage:
  # Create N parallel implementation branches
  node scripts/dispatch-parallel-implementations.mjs \\
    --n 3 --wave wave-103 --spec docs/specs/wave-103_MASTER_SPEC.md

  # After N attempts are complete, collect and compare
  node scripts/dispatch-parallel-implementations.mjs --wave wave-103 --collect

  # Single implementation (default N=1, behaves like normal dispatch)
  node scripts/dispatch-parallel-implementations.mjs --wave wave-103

Flags:
  --n <number>     Number of parallel attempts (default: 1)
  --wave <id>      Wave identifier (e.g. wave-103)
  --spec <path>    Path to master spec (optional, copied to each attempt branch)
  --story          Also build + copy a flattened story bundle (spec + inlined ancestry + ACs)
  --collect        Collect and compare completed attempts via best-of-N-judge
  --dry-run        Print what would happen without executing git commands
  --help           Show this message

Prerequisites:
  git worktree support (verified: git worktree list works on this machine)

Exit codes:
  0  Branches created successfully (or collection complete)
  1  Error creating worktrees or judge failed
`);
  process.exit(0);
}

const nIdx = args.indexOf('--n');
const n = nIdx !== -1 ? parseInt(args[nIdx + 1], 10) : 1;

const waveIdx = args.indexOf('--wave');
const waveId = waveIdx !== -1 ? args[waveIdx + 1] : 'unknown';

const specIdx = args.indexOf('--spec');
const specPath = specIdx !== -1 ? args[specIdx + 1] : null;

// --story (opt-in): hand each implementer a flattened story bundle (spec + inlined
// ancestry + ACs) instead of just the raw spec, so it does retrieval zero times (gap #5).
const useStory = args.includes('--story');
const storyRel = useStory && waveId ? `docs/specs/stories/${String(waveId).toLowerCase().replace(/[^a-z0-9.-]+/g, '-')}-build.story.md` : null;

const collect = args.includes('--collect');
const dryRun = args.includes('--dry-run');

// ── Helpers ─────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  if (dryRun) {
    console.log(`[DRY-RUN] ${cmd}`);
    return { ok: true, stdout: '', stderr: '' };
  }
  try {
    const stdout = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    });
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || String(err) };
  }
}

/**
 * Get the base branch (typically 'dev').
 */
function getCurrentBranch() {
  const r = run('git branch --show-current');
  return r.ok ? r.stdout.trim() : 'dev';
}

/**
 * Check if a worktree path already exists.
 */
function worktreeExists(worktreePath) {
  if (dryRun) return false;
  const r = run('git worktree list --porcelain');
  return r.ok && r.stdout.includes(worktreePath);
}

// ── Worktree path convention ─────────────────────────────────────────────

function attemptBranch(attempt) {
  return `${waveId}-attempt-${attempt}`;
}

function attemptWorktreePath(attempt) {
  return path.join(ROOT, '.claude', 'worktrees', `${waveId}-attempt-${attempt}`);
}

// ── Dispatch mode ─────────────────────────────────────────────────────────

if (!collect) {
  // N = 1 default: no worktrees needed.
  if (n === 1) {
    console.log(`[PARALLEL] N=1 — single implementation mode. No branches created.`);
    console.log(`[PARALLEL] Dispatch as normal single-agent implementation for ${waveId}.`);
    process.exit(0);
  }

  console.log(`\n[PARALLEL] Creating ${n} implementation branches for ${waveId}\n`);

  const createdBranches = [];
  const createdWorktrees = [];

  for (let i = 1; i <= n; i++) {
    const branch = attemptBranch(i);
    const worktreePath = attemptWorktreePath(i);

    console.log(`[PARALLEL] Creating branch ${branch} at ${worktreePath}…`);

    // Create the branch.
    const branchR = run(`git branch ${branch} HEAD 2>/dev/null || true`);
    if (!branchR.ok && !branchR.stderr.includes('already exists')) {
      console.error(`[PARALLEL] ERROR: Failed to create branch ${branch}: ${branchR.stderr}`);
      process.exit(1);
    }

    // Add worktree.
    if (!worktreeExists(worktreePath)) {
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      const wtR = run(`git worktree add ${worktreePath} ${branch}`);
      if (!wtR.ok) {
        // Worktree may already exist; try with -f.
        const wtForce = run(`git worktree add -f ${worktreePath} ${branch}`);
        if (!wtForce.ok) {
          console.error(`[PARALLEL] ERROR: Failed to add worktree for ${branch}: ${wtForce.stderr}`);
          process.exit(1);
        }
      }
    }

    // Copy spec to worktree if provided.
    if (specPath) {
      const absSpec = path.resolve(ROOT, specPath);
      const destSpec = path.join(worktreePath, specPath);
      if (fs.existsSync(absSpec) && !dryRun) {
        fs.mkdirSync(path.dirname(destSpec), { recursive: true });
        fs.copyFileSync(absSpec, destSpec);
      }
    }

    // --story: build the flattened bundle once, then copy it into each worktree (gap #5).
    if (storyRel && !dryRun) {
      try {
        if (!fs.existsSync(path.resolve(ROOT, storyRel))) {
          execSync(`node ${path.resolve(ROOT, 'scripts/shard-story-bundle.mjs')} --spec ${specPath} --wave ${waveId} --task build`, { cwd: ROOT, stdio: 'ignore' });
        }
        const absStory = path.resolve(ROOT, storyRel);
        if (fs.existsSync(absStory)) {
          const destStory = path.join(worktreePath, storyRel);
          fs.mkdirSync(path.dirname(destStory), { recursive: true });
          fs.copyFileSync(absStory, destStory);
        }
      } catch { /* best-effort; spec copy still happened */ }
    }

    createdBranches.push(branch);
    createdWorktrees.push(worktreePath);

    console.log(`[PARALLEL] Branch ${branch} ready at ${worktreePath}`);
  }

  console.log(`\n[PARALLEL] Created ${n} branches: ${createdBranches.join(', ')}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Implement ${storyRel ? `the story bundle (${storyRel}) — everything is inlined` : 'the spec'} in each worktree independently.`);
  console.log(`  2. Run: node scripts/dispatch-parallel-implementations.mjs --wave ${waveId} --collect`);
  console.log(`  3. best-of-N-judge will compare all ${n} implementations and select the winner.\n`);

  process.exit(0);
}

// ── Collect mode ──────────────────────────────────────────────────────────

console.log(`\n[PARALLEL] Collecting ${waveId} implementations for best-of-N comparison\n`);

// Find all attempt branches.
const branchListR = run(`git branch --list "${waveId}-attempt-*"`);
const branchList = branchListR.ok
  ? branchListR.stdout
      .split('\n')
      .map((b) => b.trim().replace(/^\* /, ''))
      .filter(Boolean)
  : [];

if (branchList.length === 0) {
  console.log(`[PARALLEL] No attempt branches found for ${waveId}. Nothing to collect.`);
  process.exit(0);
}

console.log(`[PARALLEL] Found ${branchList.length} attempt branch(es): ${branchList.join(', ')}`);

// Invoke best-of-N-judge agent.
const agentDefPath = path.join(ROOT, '.claude', 'agents', 'best-of-N-judge.md');

if (!fs.existsSync(agentDefPath)) {
  console.log(`[PARALLEL] SKIP — best-of-N-judge.md not found at ${agentDefPath}.`);
  console.log(`[PARALLEL] Deploy .claude/agents/best-of-N-judge.md to enable comparison.`);
  process.exit(0);
}

// Build judge prompt.
const judgeSummary = branchList
  .map((b, i) => {
    const wtp = path.join(ROOT, '.claude', 'worktrees', b);
    const exists = fs.existsSync(wtp);
    return `Attempt ${i + 1}: branch=${b}, worktree=${wtp} (${exists ? 'found' : 'not found'})`;
  })
  .join('\n');

const judgePrompt = `You are the best-of-N-judge agent per ${agentDefPath}.\n\nWave: ${waveId}\nAttempts:\n${judgeSummary}\n\nCompare all attempts on 5 metrics (LOC efficiency, test coverage delta, bundle size impact, spec AC compliance score, lint warning count) and write your comparison to docs/debates/${waveId}-bestofN.md.`;

console.log(`[PARALLEL] Invoking best-of-N-judge for ${branchList.length} attempt(s)…`);

const judgeR = run(`echo ${JSON.stringify(judgePrompt)} | npx claude --print 2>/dev/null`, { timeout: 300000 });

// Write output to debates dir.
const debatesDir = path.join(ROOT, 'docs', 'debates');
if (!fs.existsSync(debatesDir)) fs.mkdirSync(debatesDir, { recursive: true });

const bestofNPath = path.join(debatesDir, `${waveId}-bestofN.md`);

let bestofNContent;
if (judgeR.ok && judgeR.stdout.trim().length > 0) {
  bestofNContent = judgeR.stdout.trim();
} else {
  // Placeholder when judge invocation not yet wired.
  bestofNContent = `# Best-of-N Comparison — ${waveId}\n\n**N**: ${branchList.length}\n**Date**: ${new Date().toISOString()}\n**Status**: JUDGE_INVOCATION_PENDING\n\nAttempts found:\n${branchList.map((b) => `- ${b}`).join('\n')}\n\nConnect claude-sdk or npx claude to enable live judge output.\n`;
}

fs.writeFileSync(bestofNPath, bestofNContent, 'utf8');
console.log(`[PARALLEL] best-of-N comparison written to ${bestofNPath}`);

// Clean up worktrees for non-winning attempts.
// reasoning-bank (Part A): capture each attempt's diff BEFORE the worktree is
// force-removed — once it is gone the trajectory is unrecoverable. We store every
// attempt keyed by wave (the winner named in ${bestofNPath} is the positive of the
// contrastive set; the rest are the negatives) so a later distill step can mine it.
const baseBranch = getCurrentBranch();
console.log(`\n[PARALLEL] Worktree cleanup (attempts captured to reasoning-bank, then removed):`);
for (const branch of branchList) {
  const wtp = path.join(ROOT, '.claude', 'worktrees', branch);
  if (fs.existsSync(wtp)) {
    if (!dryRun) {
      // Prefer the committed branch diff; fall back to uncommitted worktree changes.
      const diffR = run(`git diff ${baseBranch}...${branch}`);
      let diff = diffR.ok ? diffR.stdout : '';
      if (!diff || !diff.trim()) {
        const wtDiff = run(`git -C ${wtp} diff`);
        diff = wtDiff.ok ? wtDiff.stdout : '';
      }
      persistArtifact({
        source: 'best-of-N',
        kind: 'attempt',
        key: waveId,
        content: diff,
        meta: { branch, bestofN: path.relative(ROOT, bestofNPath) },
      });
    }
    console.log(`  Removing worktree for ${branch} (Orchestrator merges winner manually)`);
    run(`git worktree remove ${wtp} --force 2>/dev/null || true`);
  }
}

console.log(`\n[PARALLEL] Collection complete. Review ${bestofNPath} and merge the winning branch to dev.\n`);
process.exit(0);
