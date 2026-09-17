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
 *   node scripts/dequeue-reflexion.mjs --reviewed <sha> --reviewed <sha2> # drain several
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistArtifact } from './reasoning-bank.mjs';
import { runCli } from './lib/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = path.resolve(__dirname, '..', '.claude', 'reflexion-queue');

function listQueue() {
  if (!fs.existsSync(QUEUE)) return [];
  return fs.readdirSync(QUEUE).filter((f) => f.endsWith('.md') && f !== 'README.md');
}

// Разбор строгий (2026-09-16): незнакомый флаг или лишнее слово — код 2 до удаления из очереди.
// Раньше `--reviewed a b` молча снимал только a, а `--reviwed a` печатал отказ с кодом 1.
export const CLI = {
  name: 'dequeue-reflexion',
  summary: 'Снять из очереди .claude/reflexion-queue коммиты, которые уже прошли адверсариальный разбор. Без флагов — показать очередь.',
  options: {
    list: { type: 'boolean', desc: 'показать очередь (действует и без флагов)' },
    reviewed: { type: 'string', multiple: true, value: 'sha', desc: 'снять коммит (короткий или полный SHA); флаг повторяется' },
  },
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const { values } = runCli(CLI);
  if (values.list || values.reviewed === undefined) {
    const items = listQueue();
    if (items.length === 0) {
      console.log('[reflexion] queue empty — no pending adversarial reviews.');
    } else {
      console.log(`[reflexion] ${items.length} pending:`);
      for (const f of items) console.log(`  ${f.replace('.md', '')}`);
    }
    process.exit(0);
  }

  const reviewed = values.reviewed.filter(Boolean);

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
}
