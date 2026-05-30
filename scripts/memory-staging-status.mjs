#!/usr/bin/env node
/**
 * Wave-35b — Memory MCP staging status banner.
 *
 * Lists unmerged JSON files in .claude/memory-staging/. The merge step
 * itself can't run from a script (MCP tools belong to a Claude agent's
 * context), so this is the "tell the next agent to merge" surface.
 *
 * Output is intentionally readable as a SessionStart banner. Exit code:
 *   0 — no staging files, or only the README
 *   1 — never (we don't want to block)
 *
 * Usage:
 *   node scripts/memory-staging-status.mjs              # plain text
 *   node scripts/memory-staging-status.mjs --json       # machine readable
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAGING_DIR = path.join(ROOT, '.claude/memory-staging');

const args = new Set(process.argv.slice(2));
const isJson = args.has('--json');

if (!fs.existsSync(STAGING_DIR)) {
  print({ files: [], message: 'No memory-staging directory yet.' });
  process.exit(0);
}

const files = fs
  .readdirSync(STAGING_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .reverse(); // newest first

if (files.length === 0) {
  print({ files: [], message: 'No unmerged staging files.' });
  process.exit(0);
}

const summaries = files.map((f) => {
  const full = path.join(STAGING_DIR, f);
  try {
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    return {
      file: f,
      generatedAt: data.generatedAt ?? 'unknown',
      counts: data.counts ?? {},
    };
  } catch {
    return { file: f, generatedAt: 'unparseable', counts: {} };
  }
});

print({ files: summaries });

function print(payload) {
  if (isJson) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  if (!payload.files || payload.files.length === 0) {
    process.stdout.write(`✓ Memory staging clean. ${payload.message ?? ''}\n`);
    return;
  }

  const banner = '─'.repeat(60);
  process.stdout.write(`\n${banner}\n`);
  process.stdout.write(`⚠  Unmerged memory-staging files detected\n`);
  process.stdout.write(`${banner}\n\n`);

  for (const item of payload.files) {
    const { file, generatedAt, counts } = item;
    process.stdout.write(`  ${file}\n`);
    process.stdout.write(`    generated: ${generatedAt}\n`);
    if (counts.entities || counts.observations) {
      process.stdout.write(
        `    pending:   ${counts.entities ?? 0} entities · ${counts.observations ?? 0} observations · ${counts.relations ?? 0} relations\n`,
      );
    }
    process.stdout.write('\n');
  }

  process.stdout.write('Next agent: read each file, diff against mcp__memory__read_graph(),\n');
  process.stdout.write('and call mcp__memory__create_entities / add_observations only for new\n');
  process.stdout.write('items. See .claude/memory-staging/README.md for the merge protocol.\n');
  process.stdout.write(`${banner}\n\n`);
}
