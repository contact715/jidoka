#!/usr/bin/env node
/**
 * ADR INDEX generator.
 *
 * Globs all docs/decisions/ADR-*.md, extracts Status/Wave/Date
 * fields, and writes docs/decisions/_INDEX.md with a summary table.
 *
 * Usage:
 *   node scripts/regenerate-adr-index.mjs        # write docs/decisions/_INDEX.md
 *   node scripts/regenerate-adr-index.mjs --dry  # print table, do not write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DECISIONS_DIR = path.join(ROOT, 'docs/decisions');
const OUT = path.join(DECISIONS_DIR, '_INDEX.md');
const isDry = process.argv.includes('--dry');

// Files to exclude from the index (non-ADR files in the same directory)
const EXCLUDE = new Set(['_TEMPLATE.md', 'README.md', '_INDEX.md', '_RFC_INDEX.md']);

// ── Field extractors ───────────────────────────────────────────────────
// ADRs use two bold-field conventions:
//   new format:  **Status**: Accepted    (colon after closing **)
//   old format:  **Status:** Accepted    (colon inside bold, before closing **)
// Scan first 15 lines only to avoid matching body prose.
// Exported so regenerate-rfc-index.mjs can reuse without cloning. (wave-167 D7)
export function frontmatterSlice(content) {
  return content.split('\n').slice(0, 15).join('\n');
}

export function extractBoldField(content, fieldName) {
  const fm = frontmatterSlice(content);
  // Handles: **Status**: value  AND  **Status:** value  AND  **Status** : value
  const re = new RegExp(`^\\*\\*${fieldName}[*:]*\\*\\*[:\\s]+(.+)$`, 'm');
  const m = fm.match(re);
  if (m) return m[1].trim();

  // Fallback: **Status:** (colon before closing **)
  const re2 = new RegExp(`^\\*\\*${fieldName}:\\*\\*[:\\s]+(.+)$`, 'm');
  const m2 = fm.match(re2);
  return m2 ? m2[1].trim() : null;
}

export function extractTitle(content) {
  const m = content.match(/^#\s+(.+)$/m);
  if (!m) return null;
  // Strip "ADR-NNN: " or "ADR-NNN — " prefix from title if present
  return m[1].replace(/^ADR-\d+[:\s—-]+\s*/, '').trim();
}

export function extractAdrNumber(filename) {
  const m = filename.match(/^ADR-(\d+)/);
  return m ? m[1] : '???';
}


// ── Main ───────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(DECISIONS_DIR)) {
    process.stderr.write('[warn] docs/decisions/ not found — nothing to index\n');
    process.exit(1);
  }

  const files = fs
    .readdirSync(DECISIONS_DIR)
    .filter((f) => f.endsWith('.md') && !EXCLUDE.has(f) && f.startsWith('ADR-'))
    .sort((a, b) => {
      // Sort numerically by ADR number
      const aNum = parseInt((a.match(/^ADR-(\d+)/) || [])[1] ?? '0', 10);
      const bNum = parseInt((b.match(/^ADR-(\d+)/) || [])[1] ?? '0', 10);
      return aNum - bNum;
    });

  if (files.length === 0) {
    process.stderr.write('[warn] no ADR-*.md files found in docs/decisions/\n');
    process.exit(1);
  }

  const rows = [];
  for (const file of files) {
    const filePath = path.join(DECISIONS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');

    const num = extractAdrNumber(file);
    const title = extractTitle(content) ?? file.replace(/\.md$/, '');
    const rawStatus = extractBoldField(content, 'Status') ?? 'Unknown';
    const wave = extractBoldField(content, 'Wave') ?? '—';
    const date = extractBoldField(content, 'Date') ?? '—';
    const commentPeriod = extractBoldField(content, 'Comment period') ?? null;
    const rfcRef = extractBoldField(content, 'rfc_ref') ?? null;

    // Truncate status at first pipe, comma, or parenthesis
    const statusShort = rawStatus.split(/[|,(]/)[0].trim();

    // AC-11: soft warning when Accepted ADR targeting L0/L1 has no rfc_ref
    if (statusShort === 'Accepted' && (!rfcRef || rfcRef === '—')) {
      // Heuristic: ADR targets L0/L1 if it mentions MISSION.md or L0/L1 in first 40 lines
      const top = content.split('\n').slice(0, 40).join('\n');
      if (/MISSION\.md|L0|L1\b/.test(top)) {
        process.stderr.write(
          `[adr-index] WARN — ${file}: Accepted ADR targeting L0/L1 has no rfc_ref field.\n`
        );
      }
    }

    rows.push({ num, file, title, wave, date, status: statusShort, commentPeriod });
  }

  // ── Build markdown table ─────────────────────────────────────────────
  // Row format: "| ADR-NNN | ..." so grep -c "^| ADR-" returns data row count
  const header = '| ADR # | Title | Wave | Date | Status | Comment period |';
  const sep    = '|---|---|---|---|---|---|';
  const dataRows = rows.map((r) => {
    const titleCapped = r.title.length > 55 ? r.title.slice(0, 52) + '...' : r.title;
    const link = `[ADR-${r.num}](${r.file})`;
    const cp = r.commentPeriod ?? '—';
    return `| ADR-${r.num} ${link} | ${titleCapped} | ${r.wave} | ${r.date} | ${r.status} | ${cp} |`;
  });

  const table = [header, sep, ...dataRows].join('\n');
  const timestamp = new Date().toISOString();
  const output = `# ADR Index

> Auto-generated by \`npm run adr:regen\` — do not edit manually. Last update: ${timestamp}
>
> Source: \`docs/decisions/ADR-*.md\`. To regenerate: \`node scripts/regenerate-adr-index.mjs\`

${table}
`;

  if (isDry) {
    process.stdout.write(output);
    process.exit(0);
  }

  fs.writeFileSync(OUT, output);
  process.stdout.write(`[adr-index] wrote ${rows.length} rows → docs/decisions/_INDEX.md\n`);
}

// Only run main when invoked directly (not when imported as a module by regenerate-rfc-index.mjs)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
