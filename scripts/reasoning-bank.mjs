#!/usr/bin/env node
/**
 * reasoning-bank.mjs — Capture the adversarial stack's contrast signal BEFORE it is
 * force-deleted (Part A of the reasoning-bank recommendation, 2026-W27 enrichment).
 *
 * The engine already PAYS tokens to generate losing best-of-N attempts and REVISE/BLOCK
 * reflexion reviews, then force-deletes them:
 *   - dispatch-parallel-implementations.mjs removes every attempt worktree after judging.
 *   - dequeue-reflexion.mjs unlinks a reviewed queue item.
 * Once the worktree / queue file is gone the trajectory is UNRECOVERABLE. This module is
 * the one insertion that persists the artifact just before deletion, so a later distill
 * step (Part B — a `strategy` category in extract-retro-memory.mjs) can turn contrastive
 * pairs into forward-looking strategies. Capturing has standalone value independent of
 * when distillation ships: we stop dropping signal into /dev/null.
 *
 * Design (matches the engine's invariants):
 *   - zero-dependency, pure Node builtins.
 *   - flat append-only JSONL store (docs/memory/reasoning-bank.jsonl), gitignored runtime
 *     stream like docs/audits/*.jsonl; the README under docs/memory/ is the tracked doc.
 *   - honest: empty content is a no-op (no fake row), and any write error is swallowed —
 *     a memory capture must NEVER block the pipeline it observes.
 *   - testable: REASONING_BANK_DIR overrides the store dir for isolated tests.
 *
 * Usage (library):
 *   import { persistArtifact, bankPath, readBank } from './reasoning-bank.mjs';
 *   persistArtifact({ source: 'best-of-N', kind: 'attempt', key: waveId, content: diff });
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Per-artifact content cap — keep the store bounded; a diff over this is truncated. */
export const MAX_CONTENT = 200_000;

/** Resolve the store directory (env override lets tests run in isolation). */
export function bankDir() {
  return process.env.REASONING_BANK_DIR
    ? path.resolve(process.env.REASONING_BANK_DIR)
    : path.resolve(ROOT, 'docs', 'memory');
}

/** Path to the append-only JSONL store. */
export function bankPath() {
  return path.join(bankDir(), 'reasoning-bank.jsonl');
}

/**
 * Append one contrast-signal artifact to the reasoning bank.
 *
 * @param {object} o
 * @param {string} o.source  Where the signal came from: 'best-of-N' | 'reflexion'.
 * @param {string} o.kind    Role of the artifact: 'attempt' | 'loser' | 'winner' | 'reviewed'.
 * @param {string} o.key     Task-class / wave id the artifact belongs to.
 * @param {string} [o.verdict] Optional judge verdict (REVISE|BLOCK|PASS|…) when known.
 * @param {string} o.content The raw trajectory (diff / review text). Empty → no-op.
 * @param {object} [o.meta]  Small structured pointers (branch, source file, …).
 * @returns {object|null} The written record, or null if nothing was stored.
 */
export function persistArtifact({ source, kind, key, verdict = null, content = '', meta = {} } = {}) {
  // Honest skip: never fabricate a row for an empty trajectory.
  if (typeof content !== 'string' || content.trim().length === 0) return null;

  const record = {
    ts: new Date().toISOString(),
    source: source || 'unknown',
    kind: kind || 'artifact',
    key: key || 'unknown',
    verdict,
    meta: meta && typeof meta === 'object' ? meta : {},
    content:
      content.length > MAX_CONTENT
        ? content.slice(0, MAX_CONTENT) + '\n…[truncated by reasoning-bank]'
        : content,
  };

  try {
    fs.mkdirSync(bankDir(), { recursive: true });
    fs.appendFileSync(bankPath(), JSON.stringify(record) + '\n', 'utf8');
    return record;
  } catch {
    // Best-effort: a failed memory write must not break the observed pipeline.
    return null;
  }
}

/** Read every stored artifact (skips malformed lines). Mainly for tests / a future distiller. */
export function readBank() {
  const p = bankPath();
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// CLI: `node scripts/reasoning-bank.mjs --list` prints a compact backlog for humans.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--list') || args.length === 0) {
    const items = readBank();
    if (items.length === 0) {
      console.log('[reasoning-bank] empty — no captured contrast artifacts yet.');
    } else {
      console.log(`[reasoning-bank] ${items.length} captured artifact(s):`);
      for (const it of items) {
        console.log(`  ${it.ts}  ${it.source}/${it.kind}  key=${it.key}${it.verdict ? `  verdict=${it.verdict}` : ''}  (${it.content.length} chars)`);
      }
    }
    process.exit(0);
  }
  console.error('[reasoning-bank] unknown args. Use --list.');
  process.exit(1);
}
