#!/usr/bin/env node
/**
 * Wave-35 — Retro → Memory MCP staging extractor.
 *
 * Walks docs/retros/wave-*.md, parses interesting sections (patterns,
 * gaps, decisions, lessons, anti-patterns, bash-bug-of-the-day), and
 * emits a staging JSON file that the next agent session reads and
 * explicitly syncs to memory MCP via create_entities / add_observations
 * / create_relations.
 *
 * Why staging-not-sync: scripts cannot call MCP tools. Memory writes
 * belong to a Claude agent's context with user review. This script
 * just suggests; the agent decides + dedupes against the live graph.
 *
 * Output:
 *   .claude/memory-staging/<YYYY-MM-DD>-retros-<hash>.json
 *
 * The agent dispatch hint at the bottom of the JSON tells the next
 * session how to merge: read graph → diff → call create_* for new
 * entities/observations only.
 *
 * Usage:
 *   node scripts/extract-retro-memory.mjs           # extract all, write staging
 *   node scripts/extract-retro-memory.mjs --dry     # print summary, no file write
 *   node scripts/extract-retro-memory.mjs --verbose # per-retro section dump
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RETROS_DIR = path.join(ROOT, 'docs/retros');
const STAGING_DIR = path.join(ROOT, '.claude/memory-staging');

const args = new Set(process.argv.slice(2));
const isDry = args.has('--dry');
const isVerbose = args.has('--verbose');

// ─── Section taxonomy ──────────────────────────────────────────────────
// Map heading regex → (category, weight). Higher weight = more memory-worthy.
// Sections not listed are skipped entirely (e.g. "Shipped", "Stats",
// "Verification ACs" — facts of the wave, but not learnings).
const SECTION_RULES = [
  { re: /^(pattern|patterns)\s+(observed|noticed)/i, category: 'pattern' },
  { re: /^honest\s+(gap|concession)/i, category: 'gap' },
  { re: /^honest\s+disclosure/i, category: 'gap' },
  { re: /^residual\s+gap/i, category: 'gap' },
  { re: /^decision[:\s]/i, category: 'decision' },
  { re: /^why\s+(this\s+matters|post-commit|.+\s+(work|matter))/i, category: 'rationale' },
  { re: /^lesson/i, category: 'lesson' },
  { re: /^root\s+cause/i, category: 'lesson' },
  { re: /^bash\s+bug/i, category: 'anti-pattern' },
  { re: /^anti-?pattern/i, category: 'anti-pattern' },
  { re: /^what\s+failed/i, category: 'gap' },
  { re: /^out-of-scope\s+follow/i, category: 'followup' },
];

// ─── Entry point ───────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(RETROS_DIR)) {
    console.error(`✗ retros dir not found: ${RETROS_DIR}`);
    process.exit(2);
  }

  const files = fs
    .readdirSync(RETROS_DIR)
    .filter((f) => /^wave-[\w.-]+\.md$/.test(f) && f !== '_TEMPLATE.md')
    .sort();

  const entities = [];
  const relations = [];
  let totalObservations = 0;

  for (const file of files) {
    const result = parseRetro(path.join(RETROS_DIR, file));
    if (!result) continue;
    entities.push(result.entity);
    relations.push(...result.relations);
    totalObservations += result.entity.observations.length;
    if (isVerbose) printVerbose(result);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    schema: 'memory-mcp-staging-v1',
    source: 'docs/retros/',
    counts: {
      retros: files.length,
      entities: entities.length,
      observations: totalObservations,
      relations: relations.length,
    },
    dispatchHint: [
      'Next agent session: read this file, then:',
      '1. Call mcp__memory__read_graph() to get current entities.',
      '2. For each entity here NOT in the graph, call create_entities([{...}]).',
      '3. For entities already present, diff observations and add_observations only for new ones.',
      '4. Create relations whose target entity exists in the graph; skip orphans.',
      '5. Show the user the merge summary before any irreversible writes.',
    ].join('\n'),
    entities,
    relations,
  };

  const summary = `${files.length} retros → ${entities.length} entities · ${totalObservations} observations · ${relations.length} relations`;

  if (isDry) {
    console.log(`[dry] ${summary}`);
    console.log(`[dry] sample entity:`, JSON.stringify(entities[0], null, 2));
    return;
  }

  fs.mkdirSync(STAGING_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ entities, relations }))
    .digest('hex')
    .slice(0, 8);
  const outPath = path.join(STAGING_DIR, `${date}-retros-${hash}.json`);

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`✓ ${summary}`);
  console.log(`✓ wrote ${path.relative(ROOT, outPath)}`);
}

// ─── Per-retro parsing ─────────────────────────────────────────────────
function parseRetro(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const file = path.basename(filePath);
  const waveId = extractWaveId(file);
  if (!waveId) return null;

  const sections = splitSections(raw);
  const observations = [];
  const skillsReferenced = new Set();

  for (const { heading, body } of sections) {
    const rule = SECTION_RULES.find((r) => r.re.test(heading.trim()));
    if (!rule) continue;
    const entries = extractEntries(body);
    for (const text of entries) {
      observations.push(`[${rule.category}] ${text}`);
    }
  }

  // Collect skills mentioned anywhere in body for relation graph
  for (const m of raw.matchAll(/\.claude\/skills\/([\w-]+)\.md/g)) {
    skillsReferenced.add(m[1]);
  }

  // Pull date and title from front matter
  const dateMatch = raw.match(/\*\*Date\*\*:\s*([0-9-]+)/);
  const titleMatch = raw.match(/^#\s+(.+)$/m);

  const entity = {
    name: `wave-${waveId}`,
    entityType: 'wave',
    observations: [
      `[meta] title: ${titleMatch?.[1] ?? 'untitled'}`,
      `[meta] date: ${dateMatch?.[1] ?? 'unknown'}`,
      `[meta] source: docs/retros/${file}`,
      ...observations,
    ],
  };

  const relations = [...skillsReferenced].map((skill) => ({
    from: `wave-${waveId}`,
    to: `skill-${skill}`,
    relationType: 'references-skill',
  }));

  return { entity, relations, file };
}

// ─── Helpers ───────────────────────────────────────────────────────────
function extractWaveId(filename) {
  // Match wave-NN, wave-NN.M, wave-NN.Mx, wave-NN-slug — keep only the version
  const m = filename.match(/^wave-([\d]+(?:\.[\d]+[a-z]?)?)/);
  return m?.[1] ?? null;
}

function splitSections(md) {
  // Split on level-2 headings; the body is everything until the next ## or EOF
  const lines = md.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (current) sections.push(current);
      current = { heading: h2[1], body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections;
}

function extractEntries(body) {
  // Two-pass: bullets first (dash/asterisk/numbered), fall back to
  // paragraph extraction if section has none. Tables and code blocks
  // are skipped — they're reference, not learning.
  const bullets = extractBullets(body);
  if (bullets.length > 0) return bullets;
  return extractParagraphs(body);
}

function extractBullets(body) {
  const out = [];
  const lines = body.split(/\r?\n/);
  let buf = null;
  for (const line of lines) {
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (bullet) {
      if (buf) out.push(buf.trim());
      buf = bullet[1];
    } else if (buf && line.trim() && !/^#{1,6}\s/.test(line)) {
      buf += ' ' + line.trim();
    } else if (buf) {
      out.push(buf.trim());
      buf = null;
    }
  }
  if (buf) out.push(buf.trim());
  return out
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 12);
}

function extractParagraphs(body) {
  // Split on blank lines; keep first 2 paragraphs that look like prose
  // (skip tables, code fences, sub-headings).
  const blocks = body.split(/\n\s*\n/);
  const out = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^\|/.test(trimmed)) continue; // table
    if (/^```/.test(trimmed)) continue; // code fence
    if (/^#{1,6}\s/.test(trimmed)) continue; // sub-heading
    const flat = trimmed.replace(/\s+/g, ' ');
    if (flat.length < 30) continue;
    out.push(flat);
    if (out.length >= 2) break;
  }
  return out;
}

function printVerbose({ file, entity, relations }) {
  console.log(`\n--- ${file} ---`);
  console.log(`  ${entity.observations.length} observations, ${relations.length} relations`);
  for (const o of entity.observations) console.log(`    ${o}`);
}

main();
