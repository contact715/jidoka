#!/usr/bin/env node
/**
 * Part A — Spec INDEX generator.
 *
 * Globs all docs/specs/*.md (excluding _INDEX.md, _COVERAGE.md,
 * _TASKS_TEMPLATE.md, and non-.md entries), extracts frontmatter
 * fields, and writes docs/specs/_INDEX.md with a summary table.
 *
 * Usage:
 *   node scripts/regenerate-specs-index.mjs        # write docs/specs/_INDEX.md
 *   node scripts/regenerate-specs-index.mjs --dry  # print table, do not write
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SPECS_DIR = path.join(ROOT, 'docs/specs');
const OUT = path.join(SPECS_DIR, '_INDEX.md');
const RETROS_DIR = path.join(ROOT, 'docs/retros');
const isDry = process.argv.includes('--dry');

// Files to exclude from the index
const EXCLUDE = new Set(['_INDEX.md', '_COVERAGE.md', '_TASKS_TEMPLATE.md']);

const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
};

// ── Frontmatter field extraction ───────────────────────────────────────
// Only scan the first 20 lines of a file for frontmatter fields.
// This prevents body/code-block text from matching.
function frontmatterSlice(content) {
  return content.split('\n').slice(0, 20).join('\n');
}

function extractField(content, fieldName) {
  const fm = frontmatterSlice(content);
  const re = new RegExp(`^\\*\\*${fieldName}\\*\\*:\\s*(.+)$`, 'm');
  const m = fm.match(re);
  return m ? m[1].trim() : null;
}

// ── YAML + bold-field two-pass parser (wave-117) ───────────────────────
// Pass 1: extract YAML frontmatter block (--- ... ---) at top of file.
// Pass 2: fall back to bold-field regex if YAML block absent.
// Returns null for missing fields — never throws.
function extractYamlBlock(content) {
  const m = content.match(/^---\n([\s\S]+?)\n---\n/);
  return m ? m[1] : null;
}

function extractYamlField(yamlBlock, fieldName) {
  if (!yamlBlock) return null;
  const re = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const m = yamlBlock.match(re);
  return m ? m[1].trim() : null;
}

// Extract `parents:` array from YAML block. Returns [] if not found.
// Supports multi-line YAML list format:
//   parents:
//     - path: docs/MISSION.md
//       version: 1.0.0
//       relationship: implements
function extractYamlParents(yamlBlock) {
  if (!yamlBlock) return [];
  const parentsMatch = yamlBlock.match(/^parents:\n((?:[ \t]+.*\n?)+)/m);
  if (!parentsMatch) return [];
  const block = parentsMatch[1];
  const entries = [];
  const itemRe = /^[\s\t]+-\s+path:\s*(.+)$/m;
  const items = block.split(/^[\s\t]+-\s+path:/m).slice(1);
  for (const item of items) {
    const pathVal = item.split('\n')[0].trim();
    const versionM = item.match(/version:\s*(.+)/);
    const relM = item.match(/relationship:\s*(.+)/);
    entries.push({
      path: pathVal,
      version: versionM ? versionM[1].trim() : null,
      relationship: relM ? relM[1].trim() : null,
    });
  }
  return entries;
}

// Two-pass level extractor: YAML first, bold-field fallback.
function extractLevel(content) {
  const yamlBlock = extractYamlBlock(content);
  const fromYaml = extractYamlField(yamlBlock, 'level');
  if (fromYaml) return fromYaml;
  // Bold-field fallback: **level**: L4
  const fm = frontmatterSlice(content);
  const m = fm.match(/^\*\*level\*\*:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

// Two-pass version extractor: YAML first, bold-field fallback.
function extractVersion(content) {
  const yamlBlock = extractYamlBlock(content);
  const fromYaml = extractYamlField(yamlBlock, 'version');
  if (fromYaml) return fromYaml;
  const fm = frontmatterSlice(content);
  const m = fm.match(/^\*\*version\*\*:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractTitle(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractDependsOn(content) {
  const raw = extractField(content, 'depends_on');
  if (!raw) return [];
  // Supports: [wave-78, wave-77] or wave-78, wave-77
  return raw.replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

// ── Spec ID and type inference ─────────────────────────────────────────
function inferSpecId(filename) {
  const m = filename.match(/^wave-([\d]+(?:\.[\d]+[a-z]?)?)/);
  if (m) return `wave-${m[1]}`;
  return filename.replace(/_MASTER_SPEC\.md$/, '').replace(/\.md$/, '');
}

function inferType(filename) {
  return /^wave-\d/.test(filename) ? 'wave-spec' : 'named-spec';
}

function inferWaveShipped(filename) {
  const m = filename.match(/^wave-([\d]+(?:\.[\d]+[a-z]?)?)/);
  return m ? `wave-${m[1]}` : '-';
}

// ── Retro detection ────────────────────────────────────────────────────
function findRetro(waveId) {
  if (!fs.existsSync(RETROS_DIR)) return '-';
  // waveId is like "wave-84" — retro might be wave-84.md or wave-84-something.md
  const num = waveId.replace('wave-', '');
  // Try exact match first
  const exact = path.join(RETROS_DIR, `${waveId}.md`);
  if (fs.existsSync(exact)) return `docs/retros/${waveId}.md`;
  // Try prefix match for e.g. wave-09-hvac-funnels-restructure.md
  const files = fs.readdirSync(RETROS_DIR);
  const prefixed = files.find((f) => f.startsWith(`wave-${num}-`) || f === `wave-${num}.md`);
  if (prefixed) return `docs/retros/${prefixed}`;
  return '-';
}

// ── Commit count for a spec file ───────────────────────────────────────
function commitCount(specFile) {
  const rel = path.relative(ROOT, specFile);
  const out = sh(`git log --oneline --all -- "${rel}"`);
  if (!out) return '0';
  return String(out.split('\n').filter(Boolean).length);
}

// ── Dangling-dependency check ──────────────────────────────────────────
function checkDangling(deps, knownIds) {
  const result = [];
  for (const dep of deps) {
    if (!knownIds.has(dep)) {
      process.stderr.write(`[warn] dangling depends_on reference: "${dep}" — no matching spec found\n`);
      result.push(`${dep}*`);
    } else {
      result.push(dep);
    }
  }
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(SPECS_DIR)) {
    process.stderr.write('[warn] docs/specs/ not found — nothing to index\n');
    process.exit(0);
  }

  const files = fs
    .readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.md') && !EXCLUDE.has(f) && !f.endsWith('_TASKS.md'))
    .sort((a, b) => {
      // Sort wave-NN numerically, named specs alphabetically after
      const aNum = (a.match(/^wave-(\d+)/) || [])[1];
      const bNum = (b.match(/^wave-(\d+)/) || [])[1];
      if (aNum && bNum) return Number(aNum) - Number(bNum);
      if (aNum) return -1;
      if (bNum) return 1;
      return a.localeCompare(b);
    });

  // Build known spec IDs set for dangling-ref detection
  const knownIds = new Set(files.map(inferSpecId));

  const rows = [];
  for (const file of files) {
    const filePath = path.join(SPECS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');

    const specId = inferSpecId(file);
    const title = extractTitle(content) ?? file;
    const status = extractField(content, 'Status') ?? 'Draft';
    const effort = extractField(content, 'Effort') ?? '?';
    const waveShipped = inferWaveShipped(file);
    const retro = findRetro(specId);
    const commits = commitCount(filePath);
    const rawDeps = extractDependsOn(content);
    const deps = rawDeps.length > 0 ? checkDangling(rawDeps, knownIds).join(', ') : '-';

    // Infer BE dep: look for explicit mention of the backend or API dep in §2/§3
    const beDep = /the backend|backend dep|BE dep|backend endpoint/i.test(content) ? 'yes' : '-';

    // Level: YAML two-pass (wave-117)
    const level = extractLevel(content) ?? '?';

    rows.push({
      specId,
      title: title.length > 60 ? title.slice(0, 57) + '...' : title,
      status: status.split(/[|(\s]/)[0].trim(),  // only first token if compound
      effort,
      level,
      beDep,
      waveShipped,
      commits,
      retro: retro !== '-' ? `[retro](../../${retro})` : '-',
      lineage: deps,
    });
  }

  // ── Build markdown table ─────────────────────────────────────────────
  const header = '| Spec ID | Title | Status | Effort | Level | BE dep | Wave shipped | Commits | Retro | Lineage |';
  const sep    = '|---|---|---|---|---|---|---|---|---|---|';
  const dataRows = rows.map((r) =>
    `| ${r.specId} | ${r.title} | ${r.status} | ${r.effort} | ${r.level} | ${r.beDep} | ${r.waveShipped} | ${r.commits} | ${r.retro} | ${r.lineage} |`
  );

  const table = [header, sep, ...dataRows].join('\n');
  const timestamp = new Date().toISOString();
  const output = `# Spec INDEX

> Auto-generated by \`scripts/regenerate-specs-index.mjs\` — do not edit manually. Last update: ${timestamp}

${table}
`;

  if (isDry) {
    process.stdout.write(output);
    process.exit(0);
  }

  fs.writeFileSync(OUT, output);
  process.stdout.write(`[specs-index] wrote ${rows.length} rows → docs/specs/_INDEX.md\n`);
}

main();
