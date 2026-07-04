#!/usr/bin/env node
/**
 * dequeue-reflexion.mjs — Mark an adversarial-review queue item as processed.
 *
 * The post-commit hook (auto-reflexion-trigger.sh) flags large commits into
 * .claude/reflexion-queue/<sha>.md. After the Reflexion Critic (or a debate /
 * best-of-N pass) has reviewed that commit, remove its queue file so the
 * backlog reflects REAL pending work — not commits already reviewed.
 *
 * This is the dequeue half the trigger documents but never performs itself
 * (review is an orchestrator action; the hook only flags).
 *
 * Usage:
 *   node scripts/dequeue-reflexion.mjs --reviewed <sha>      # drain one (by short or full SHA)
 *   node scripts/dequeue-reflexion.mjs --list                # show the backlog
 *   node scripts/dequeue-reflexion.mjs --reviewed <sha> [...] # drain several
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistArtifact } from './reasoning-bank.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = path.resolve(__dirname, '..', '.claude', 'reflexion-queue');

function listQueue() {
  if (!fs.existsSync(QUEUE)) return [];
  return fs.readdirSync(QUEUE).filter((f) => f.endsWith('.md') && f !== 'README.md');
}

const args = process.argv.slice(2);

if (args.includes('--list') || args.length === 0) {
  const items = listQueue();
  if (items.length === 0) {
    console.log('[reflexion] queue empty — no pending adversarial reviews.');
  } else {
    console.log(`[reflexion] ${items.length} pending:`);
    for (const f of items) console.log(`  ${f.replace('.md', '')}`);
  }
  process.exit(0);
}

const reviewed = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--reviewed') {
    const sha = args[i + 1];
    if (sha && !sha.startsWith('--')) reviewed.push(sha);
  }
}

if (reviewed.length === 0) {
  console.error('[reflexion] no --reviewed <sha> given. Use --list to see the backlog.');
  process.exit(1);
}

let removed = 0;
const items = listQueue();
for (const sha of reviewed) {
  const short = sha.slice(0, 7);
  const match = items.find((f) => f.startsWith(short) || f.replace('.md', '') === sha);
  if (match) {
    const full = path.join(QUEUE, match);
    // reasoning-bank (Part A): keep the reviewed reflexion artifact before its queue
    // marker is unlinked — the reviewed trajectory is otherwise unrecoverable.
    try {
      const content = fs.readFileSync(full, 'utf8');
      persistArtifact({
        source: 'reflexion',
        kind: 'reviewed',
        key: match.replace('.md', ''),
        content,
        meta: { queueFile: match },
      });
    } catch { /* best-effort — never block the dequeue on a memory write */ }
    fs.unlinkSync(full);
    console.log(`[reflexion] dequeued ${match.replace('.md', '')} (reviewed).`);
    removed++;
  } else {
    console.warn(`[reflexion] no queue item matched "${sha}" — skipped.`);
  }
}
console.log(`[reflexion] done — ${removed} dequeued, ${listQueue().length} remaining.`);
