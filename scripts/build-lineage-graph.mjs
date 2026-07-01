#!/usr/bin/env node
/**
 * Part D — Lineage Graph Builder (wave-117).
 * Wave-169: Extended — add --json flag emitting docs/specs/_LINEAGE.json
 *   with node/edge types: wave, ADR, anti-pattern, file, spec.
 *   ID normalization: canonical wave-NNN (3-digit zero-padded), R2/Tn stripped.
 *   Dangling edge honesty: unresolved parents tagged { resolved: false }.
 *   Emits graph_built telemetry event to kg-events.jsonl on completion.
 *
 * DO NOT EDIT docs/specs/_LINEAGE.json by hand — regenerate with kg:build.
 *
 * Scans all spec files under docs/ for YAML frontmatter parents[].path
 * declarations and generates a Mermaid graph TD diagram at
 * docs/specs/_LINEAGE.md.
 *
 * Also flags:
 *   [ORPHAN]          — specs with no in-edges AND no out-edges
 *   [MISSING METADATA] — specs with level or version absent
 *
 * Usage:
 *   node scripts/build-lineage-graph.mjs           # write docs/specs/_LINEAGE.md
 *   node scripts/build-lineage-graph.mjs --dry     # print to stdout, do not write
 *   node scripts/build-lineage-graph.mjs --counts  # print orphan/missing-meta counts only, write nothing
 *   node scripts/build-lineage-graph.mjs --json    # also write docs/specs/_LINEAGE.json
 *   node scripts/build-lineage-graph.mjs --json --dry  # JSON to stdout, no writes
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emitTelemetry } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/specs/_LINEAGE.md');
const OUT_JSON = path.join(ROOT, 'docs/specs/_LINEAGE.json');
const isDry = process.argv.includes('--dry');
const isJson = process.argv.includes('--json');
// --counts: read-only measurement for the structural gate. Computes orphan / missing-meta
// counts and prints ONLY the summary line; writes nothing (no _LINEAGE.md, no _LINEAGE.json,
// no telemetry). This is what lets spec-structural-gate measure without self-mutating.
const isCounts = process.argv.includes('--counts');

// ── Wave-169: ID normalization ─────────────────────────────────────────
// Canonical wave ID: wave-NNN (3-digit zero-padded, no R2/Tn suffix).
// Revision labels are preserved separately.
// Input examples: "wave-145", "wave-9", "wave-148.R2", "wave-09", "wave-117-retro"
const WAVE_NORM_RE = /wave-(\d+)(?:\.[RT]\d+)?(?:-[\w-]+)?/i;

function normalizeWaveId(raw) {
  if (!raw) return null;
  const m = String(raw).match(WAVE_NORM_RE);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  return `wave-${String(num).padStart(3, '0')}`;
}

function extractRevisionSuffix(raw) {
  if (!raw) return null;
  const m = String(raw).match(/wave-\d+(\.([RT]\d+))/i);
  return m ? m[1] : null;
}

// ── YAML + bold-field two-pass parser (shared contract from T.1) ───────
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

function extractYamlParents(yamlBlock) {
  if (!yamlBlock) return [];
  const parentsMatch = yamlBlock.match(/^parents:\n((?:[ \t]+.*\n?)+)/m);
  if (!parentsMatch) return [];
  const block = parentsMatch[1];
  const items = block.split(/^[\s\t]+-\s+path:/m).slice(1);
  const entries = [];
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

function extractBoldField(content, fieldName) {
  const lines = content.split('\n').slice(0, 20).join('\n');
  const re = new RegExp(`^\\*\\*${fieldName}\\*\\*:\\s*(.+)$`, 'm');
  const m = lines.match(re);
  return m ? m[1].trim() : null;
}

// Wave-167: extract Supersedes bold-field from the full document body.
// ADRs standardise on **Supersedes:** per D5 — parseable by the same regex but
// the field can appear anywhere in the document, not just the header slice.
//
// Wave-169 R2 fix: constrain captured value to a real ADR/file token only.
// Reject any value containing spaces or parentheses — those are prose sentences,
// not file references. Only accept values matching ADR-NNN patterns or file paths.
// Valid examples: "ADR-002-token-storage.md", "./ADR-002-foo.md", "docs/decisions/ADR-002.md"
// Invalid (prose): "parts of DEC-002 (capabilities...)", "DEC-002 and foo", etc.
const SUPERSEDES_TOKEN_RE = /^(ADR-\d+[\w.-]*|\.?\/?[\w./-]+\.md)$/;

function extractSupersedesBoldField(content) {
  // Match both **Supersedes:** value  AND  **Supersedes** : value
  const re = /^\*\*Supersedes[*:]*\*\*[:\s]+(.+)$/m;
  const m = content.match(re);
  if (m) {
    // Strip markdown link syntax if present: [text](path) → path
    const raw = m[1].replace(/\[.*?\]\((.*?)\)/g, '$1').trim();
    // Reject prose values — only accept clean ADR/file tokens (no spaces, no parens)
    if (!SUPERSEDES_TOKEN_RE.test(raw)) return null;
    return raw;
  }
  return null;
}

function extractVersion(content) {
  const yamlBlock = extractYamlBlock(content);
  const fromYaml = extractYamlField(yamlBlock, 'version');
  if (fromYaml) return fromYaml;
  return extractBoldField(content, 'version');
}

function extractTitle(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

// ── Node ID sanitiser ──────────────────────────────────────────────────
// Mermaid node IDs must not contain spaces or special chars.
// Truncate to 40 chars to keep diagram readable.
function sanitiseNodeId(relPath) {
  return relPath
    .replace(/[^a-zA-Z0-9_/.-]/g, '_')
    .replace(/[/.]/g, '_')
    .slice(0, 40);
}

// ── File discovery ─────────────────────────────────────────────────────
// Wave-169 R2 fix: exclude non-spec doc subtrees from spec-NODE creation.
// These directories contain retros, briefs, checklists, runbooks, and
// level templates — none carry governance lineage. They can still appear as
// touch-edge targets if a wave commit touched them (git log path).
// Prefix matching is relative to docs/ to keep the list minimal.
const SPEC_EXCLUDE_PREFIXES = [
  'retros',
  'runs',          // transient per-wave run-state journals (STATE.md), not governance specs
  'checklists',
  'runbooks',
  'specs/briefs',
  'specs/_LEVEL_TEMPLATES',
  'archive',
  'blog',
  'marketing',
  'intel',
  'debates',
  'evals',
  'audit-reports',
  'audit',
  'metrics',
  'analytics',
  'business',
  'optimization',
];

function collectSpecFiles() {
  const DOCS_DIR = path.join(ROOT, 'docs');
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
        // Check if this directory path falls under an excluded prefix
        const relDir = path.relative(DOCS_DIR, fullPath);
        const isExcluded = SPEC_EXCLUDE_PREFIXES.some(
          prefix => relDir === prefix || relDir.startsWith(prefix + path.sep)
        );
        if (isExcluded) continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (entry.name.startsWith('_')) continue;
        results.push(fullPath);
      }
    }
  }

  walk(DOCS_DIR);
  return filterGitIgnored(results);
}

// Drop gitignored .md files (e.g. docs/CURRENT_WAVE.md, docs/surfacing-concerns-current.md)
// from the spec corpus. These are runtime-generated docs, absent in a clean checkout and
// recreated by hooks; collecting them would add a parentless ORPHAN + MISSING-META node
// whenever they happen to exist on disk, making the counts flap between CI and local.
// gitignore membership is pattern-based (independent of existence) → deterministic.
// Guarded: git absent / not a repo → returns the list unchanged (portable fallback).
function filterGitIgnored(absPaths) {
  if (!absPaths.length) return absPaths;
  const rel = absPaths.map(p => path.relative(ROOT, p).replace(/\\/g, '/'));
  const ignored = new Set();
  const collect = (out) => { for (const line of String(out).split('\n')) { const t = line.trim(); if (t) ignored.add(t); } };
  try {
    collect(execSync('git check-ignore --stdin', { cwd: ROOT, input: rel.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));
  } catch (e) {
    if (e && typeof e.stdout === 'string') collect(e.stdout);
  }
  if (!ignored.size) return absPaths;
  return absPaths.filter(p => !ignored.has(path.relative(ROOT, p).replace(/\\/g, '/')));
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  const files = collectSpecFiles();

  // Build spec metadata map
  const specMap = new Map(); // relPath → { nodeId, title, level, version, parents[] }

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const relPath = path.relative(ROOT, filePath);
    const yamlBlock = extractYamlBlock(content);
    const parents = extractYamlParents(yamlBlock);
    const level = extractYamlField(yamlBlock, 'level') ?? extractBoldField(content, 'level') ?? null;
    const version = extractVersion(content);
    const title = extractTitle(content) ?? relPath;
    const nodeId = sanitiseNodeId(relPath);

    specMap.set(relPath, { nodeId, title, level, version, parents, filePath });
  }

  // Build edge sets for orphan detection
  const hasOutEdge = new Set(); // relPaths with parents[] entries
  const hasInEdge = new Set();  // relPaths that appear as a parent of another spec

  for (const [relPath, spec] of specMap) {
    for (const parent of spec.parents) {
      hasOutEdge.add(relPath);
      hasInEdge.add(parent.path);
    }
  }

  // Build Mermaid edges
  const edges = [];
  for (const [relPath, spec] of specMap) {
    for (const parent of spec.parents) {
      const parentSpec = specMap.get(parent.path);
      const parentId = parentSpec ? parentSpec.nodeId : sanitiseNodeId(parent.path);
      const childId = spec.nodeId;
      const label = parent.relationship ? `|${parent.relationship}|` : '';
      edges.push(`  ${parentId} -->${label} ${childId}`);
    }
  }

  // Wave-167: Supersedes directed edges from **Supersedes:** bold-field (D5, AC-6).
  // The superseding ADR points to the superseded ADR with a "Supersedes" label.
  for (const [relPath, spec] of specMap) {
    let content;
    try {
      content = fs.readFileSync(spec.filePath, 'utf8');
    } catch {
      continue;
    }
    const supersedes = extractSupersedesBoldField(content);
    if (!supersedes || supersedes === 'None' || supersedes === '—') continue;
    // supersedes may be a relative path like "./ADR-002-*.md" or a bare name
    // Normalise to a docs/decisions/-prefixed path for lookup
    let supersededPath = supersedes;
    if (!supersededPath.startsWith('docs/')) {
      // Strip leading ./ and anchor it under docs/decisions/
      const bare = supersededPath.replace(/^\.\//, '');
      supersededPath = `docs/decisions/${bare}`;
    }
    const supersededSpec = specMap.get(supersededPath);
    const supersededId = supersededSpec ? supersededSpec.nodeId : sanitiseNodeId(supersededPath);
    const supersedingId = spec.nodeId;
    edges.push(`  ${supersedingId} -->|Supersedes| ${supersededId}`);
    // Mark these nodes as connected for orphan detection
    hasOutEdge.add(relPath);
    hasInEdge.add(supersededPath);
  }

  // Classify specs
  const orphans = [];
  const missingMeta = [];

  for (const [relPath, spec] of specMap) {
    const isOrphan = !hasOutEdge.has(relPath) && !hasInEdge.has(relPath);
    if (isOrphan) {
      orphans.push({ relPath, title: spec.title });
    }
    if (!spec.level || !spec.version) {
      missingMeta.push({
        relPath,
        missing: [
          !spec.level ? 'level' : null,
          !spec.version ? 'version' : null,
        ].filter(Boolean).join(', '),
      });
    }
  }

  // --counts: read-only measurement for the structural gate. Emit only the summary
  // counts and exit before any file is written or any telemetry is emitted.
  if (isCounts) {
    process.stdout.write(`[lineage-graph] orphans: ${orphans.length}, missing-meta: ${missingMeta.length}\n`);
    process.exit(0);
  }

  // Build node declarations with labels
  const nodeDecls = [];
  for (const [relPath, spec] of specMap) {
    const levelStr = spec.level ? ` (${spec.level})` : '';
    const shortTitle = spec.title.length > 35 ? spec.title.slice(0, 32) + '...' : spec.title;
    nodeDecls.push(`  ${spec.nodeId}["${shortTitle}${levelStr}"]`);
  }

  // Assemble output
  const timestamp = new Date().toISOString();
  const lines = [];

  lines.push('# Spec Lineage Graph');
  lines.push('');
  lines.push(`> Auto-generated by \`build-lineage-graph.mjs\` — do not edit manually. Last update: ${timestamp}`);
  lines.push('');
  lines.push('```mermaid');
  lines.push('graph TD');

  // Node declarations first (avoids implicit nodes from edges)
  for (const decl of nodeDecls) {
    lines.push(decl);
  }

  // Edges
  for (const edge of edges) {
    lines.push(edge);
  }

  lines.push('```');
  lines.push('');

  // Orphan section
  lines.push('## [ORPHAN] Specs with no parent or child connections');
  lines.push('');
  if (orphans.length === 0) {
    lines.push('_No orphans detected._');
  } else {
    lines.push('| Spec | Title |');
    lines.push('|---|---|');
    for (const o of orphans) {
      lines.push(`| ${o.relPath} | ${o.title} |`);
    }
  }
  lines.push('');

  // Missing metadata section
  lines.push('## [MISSING METADATA] Specs without level or version fields');
  lines.push('');
  if (missingMeta.length === 0) {
    lines.push('_All specs have level and version fields._');
  } else {
    lines.push('| Spec | Missing fields |');
    lines.push('|---|---|');
    for (const m of missingMeta) {
      lines.push(`| ${m.relPath} | ${m.missing} |`);
    }
  }
  lines.push('');

  const output = lines.join('\n');

  if (isDry && !isJson) {
    process.stdout.write(output);
    process.exit(0);
  }

  if (!isDry) {
    fs.writeFileSync(OUT, output, 'utf8');
  }

  const mermaidEdgeCount = edges.length;
  const mermaidNodeCount = specMap.size;

  if (!isDry) {
    process.stdout.write(
      `[lineage-graph] wrote ${mermaidNodeCount} nodes, ${mermaidEdgeCount} edges → docs/specs/_LINEAGE.md\n` +
      `[lineage-graph] orphans: ${orphans.length}, missing-meta: ${missingMeta.length}\n`
    );
  }

  // ── Wave-169: JSON emit ────────────────────────────────────────────────
  // DO NOT EDIT docs/specs/_LINEAGE.json by hand — always regenerate with kg:build.
  if (isJson) {
    const jsonGraph = buildJsonGraph(specMap, orphans);

    if (isDry) {
      process.stdout.write(JSON.stringify(jsonGraph, null, 2) + '\n');
      process.exit(0);
    }

    fs.writeFileSync(OUT_JSON, JSON.stringify(jsonGraph, null, 2) + '\n', 'utf8');
    const jNodeCount = jsonGraph.nodes.length;
    const jEdgeCount = jsonGraph.edges.length;
    const unresolvedCount = jsonGraph.nodes.filter(n => !n.resolved).length;

    process.stdout.write(
      `[lineage-graph] wrote ${jNodeCount} nodes, ${jEdgeCount} edges → docs/specs/_LINEAGE.json\n` +
      `[lineage-graph] unresolved: ${unresolvedCount}, orphans: ${orphans.length}\n`
    );

    if (jNodeCount > 2000) {
      process.stdout.write(
        `[lineage-graph] WARN — graph size exceeds recommended threshold (${jNodeCount} nodes); consider SQLite migration\n`
      );
    }

    // Wave-169 R2 fix: compute isolation over the ACTUAL shipped JSON graph.
    // isolated_node_count = nodes in _LINEAGE.json with zero in- AND out-edges.
    // spec_orphan_count   = Mermaid spec-only orphan count (different corpus).
    // These two numbers describe different graphs; never conflate them.
    const srcSet = new Set(jsonGraph.edges.map(e => e.src));
    const dstSet = new Set(jsonGraph.edges.map(e => e.dst));
    const isolatedNodeCount = jsonGraph.nodes.filter(
      n => !srcSet.has(n.id) && !dstSet.has(n.id)
    ).length;

    // Emit graph_built telemetry event to kg-events.jsonl (wave-169 AC-12)
    emitTelemetry('graph_built', {
      source: 'scripts/build-lineage-graph.mjs',
      wave: 'wave-169',
      agent: 'build-lineage-graph',
      payload: {
        node_count: jNodeCount,
        edge_count: jEdgeCount,
        isolated_node_count: isolatedNodeCount,
        spec_orphan_count: orphans.length,
        isolated_ratio: `${isolatedNodeCount}/${jNodeCount}`,
        built_at: new Date().toISOString(),
      },
    });
  }

  process.exit(0);
}

// ── Wave-169: JSON graph builder ───────────────────────────────────────
// Builds { nodes[], edges[], meta } from specMap + ADR files + anti-patterns.
// ID normalization: wave-NNN (3-digit zero-padded), R2/Tn stored in revisions[].
// Dangling refs: resolved: false, kind: "missing".
function buildJsonGraph(specMap, orphans) {
  const nodesMap = new Map(); // id → node object (deduplication)
  const jsonEdges = [];

  // Helper: ensure a node exists in the map; if it already exists, merge revisions
  function ensureNode(id, props) {
    if (!nodesMap.has(id)) {
      nodesMap.set(id, { id, ...props, revisions: props.revisions ?? [] });
    } else {
      // Merge revisions
      const existing = nodesMap.get(id);
      if (props.revisions) {
        for (const r of props.revisions) {
          if (!existing.revisions.includes(r)) existing.revisions.push(r);
        }
      }
    }
    return nodesMap.get(id);
  }

  // 1. Spec nodes from specMap
  for (const [relPath, spec] of specMap) {
    // Extract wave reference from YAML frontmatter if present
    const yamlBlock = extractYamlBlock(fs.readFileSync(spec.filePath, 'utf8'));
    const waveRaw = extractYamlField(yamlBlock, 'wave');

    const specNodeId = `spec:${relPath}`;
    ensureNode(specNodeId, {
      kind: 'spec',
      label: spec.title ?? relPath,
      resolved: true,
      level: spec.level ?? null,
      version: spec.version ?? null,
      path: relPath,
    });

    // Wave node if present
    if (waveRaw) {
      const waveNorm = normalizeWaveId(waveRaw);
      const revision = extractRevisionSuffix(waveRaw);
      if (waveNorm) {
        const waveNodeId = `wave:${waveNorm}`;
        const waveNode = ensureNode(waveNodeId, {
          kind: 'wave',
          label: waveNorm,
          resolved: true,
          revisions: revision ? [waveRaw] : [],
        });
        if (revision && !waveNode.revisions.includes(waveRaw)) {
          waveNode.revisions.push(waveRaw);
        }
        // spec → wave edge (spec belongs-to wave)
        jsonEdges.push({
          src: specNodeId,
          rel: 'belongs-to',
          dst: waveNodeId,
          wave: waveNorm,
          agent: null,
        });
      }
    }

    // parent-of edges (spec → parent spec)
    for (const parent of spec.parents) {
      const parentRelPath = parent.path;
      const parentExists = fs.existsSync(path.join(ROOT, parentRelPath));
      const parentNodeId = `spec:${parentRelPath}`;

      if (!parentExists) {
        // Dangling ref — D6: tag resolved: false
        ensureNode(parentNodeId, {
          kind: 'missing',
          label: parentRelPath,
          resolved: false,
          path: parentRelPath,
        });
      } else if (!nodesMap.has(parentNodeId)) {
        // Will be added when specMap iteration reaches it — pre-create placeholder
        ensureNode(parentNodeId, {
          kind: 'spec',
          label: parentRelPath,
          resolved: true,
          path: parentRelPath,
        });
      }

      jsonEdges.push({
        src: specNodeId,
        rel: parent.relationship ?? 'parent-of',
        dst: parentNodeId,
        wave: null,
        agent: null,
      });
    }

    // Supersedes edges
    let contentForSupersedes;
    try {
      contentForSupersedes = fs.readFileSync(spec.filePath, 'utf8');
    } catch {
      contentForSupersedes = null;
    }
    if (contentForSupersedes) {
      const supersedes = extractSupersedesBoldField(contentForSupersedes);
      if (supersedes && supersedes !== 'None' && supersedes !== '—') {
        let supersededPath = supersedes;
        if (!supersededPath.startsWith('docs/')) {
          supersededPath = `docs/decisions/${supersededPath.replace(/^\.\//, '')}`;
        }
        const supersededExists = fs.existsSync(path.join(ROOT, supersededPath));
        const supersededNodeId = `spec:${supersededPath}`;
        ensureNode(supersededNodeId, {
          kind: supersededExists ? 'spec' : 'missing',
          label: supersededPath,
          resolved: supersededExists,
          path: supersededPath,
        });
        jsonEdges.push({
          src: specNodeId,
          rel: 'supersedes',
          dst: supersededNodeId,
          wave: null,
          agent: null,
        });
      }
    }
  }

  // 2. ADR nodes from docs/decisions/ADR-*.md
  const DECISIONS_DIR = path.join(ROOT, 'docs/decisions');
  if (fs.existsSync(DECISIONS_DIR)) {
    const adrFiles = fs.readdirSync(DECISIONS_DIR)
      .filter(f => f.startsWith('ADR-') && f.endsWith('.md'));
    for (const adrFile of adrFiles) {
      const adrPath = path.join(DECISIONS_DIR, adrFile);
      let adrContent;
      try {
        adrContent = fs.readFileSync(adrPath, 'utf8');
      } catch {
        continue;
      }
      const relAdrPath = path.relative(ROOT, adrPath);
      // Extract ADR number from filename
      const adrNumM = adrFile.match(/^ADR-(\d+)/);
      const adrNum = adrNumM ? adrNumM[1] : '???';
      const adrNodeId = `adr:ADR-${String(parseInt(adrNum, 10)).padStart(3, '0')}`;
      const titleM = adrContent.match(/^#\s+(.+)$/m);
      const adrTitle = titleM ? titleM[1].replace(/^ADR-\d+[:\s—-]+\s*/, '').trim() : adrFile;

      // Bold-field status
      const statusM = adrContent.match(/^\*\*Status[*:]*\*\*[:\s]+(.+)$/m);
      const status = statusM ? statusM[1].trim() : null;

      ensureNode(adrNodeId, {
        kind: 'adr',
        label: adrTitle,
        resolved: true,
        path: relAdrPath,
        status: status ?? null,
      });

      // Also ensure a spec: node for this file so lineage queries can find it
      const specNodeId = `spec:${relAdrPath}`;
      if (!nodesMap.has(specNodeId)) {
        ensureNode(specNodeId, {
          kind: 'adr',
          label: adrTitle,
          resolved: true,
          path: relAdrPath,
        });
      }

      // ADR → Supersedes edge
      const supersedesM = adrContent.match(/^\*\*Supersedes[*:]*\*\*[:\s]+(.+)$/m);
      if (supersedesM) {
        const raw = supersedesM[1].trim();
        if (raw && raw !== 'None' && raw !== '—' && raw !== '-') {
          const bare = raw.replace(/\[.*?\]\((.*?)\)/g, '$1').replace(/^\.\//, '');
          const supersededNum = bare.match(/^ADR-(\d+)/);
          if (supersededNum) {
            const supersededAdrId = `adr:ADR-${String(parseInt(supersededNum[1], 10)).padStart(3, '0')}`;
            const supersededRelPath = `docs/decisions/${bare}`;
            const supersededExists = fs.existsSync(path.join(ROOT, supersededRelPath));
            ensureNode(supersededAdrId, {
              kind: supersededExists ? 'adr' : 'missing',
              label: bare,
              resolved: supersededExists,
              path: supersededRelPath,
            });
            jsonEdges.push({
              src: adrNodeId,
              rel: 'supersedes',
              dst: supersededAdrId,
              wave: null,
              agent: null,
            });
          }
        }
      }
    }
  }

  // 3. Anti-pattern nodes from docs/memory-anti-patterns.md
  const AP_FILE = path.join(ROOT, 'docs/memory-anti-patterns.md');
  if (fs.existsSync(AP_FILE)) {
    const apContent = fs.readFileSync(AP_FILE, 'utf8');
    // Parse table rows: | `slug` | AntiPattern | observation | wave |
    const tableRowRe = /^\|\s*`([^`]+)`\s*\|\s*AntiPattern\s*\|\s*[^|]+\|\s*([^|]+)\|/gm;
    for (const m of apContent.matchAll(tableRowRe)) {
      const slug = m[1].trim();
      const waveRaw = m[2].trim();
      const apNodeId = `anti-pattern:${slug}`;
      const waveNorm = normalizeWaveId(waveRaw);

      ensureNode(apNodeId, {
        kind: 'anti-pattern',
        label: slug,
        resolved: true,
        slug,
      });

      if (waveNorm) {
        const waveNodeId = `wave:${waveNorm}`;
        ensureNode(waveNodeId, {
          kind: 'wave',
          label: waveNorm,
          resolved: true,
          revisions: [],
        });
        // wave → anti-pattern: triggered edge
        jsonEdges.push({
          src: waveNodeId,
          rel: 'triggered',
          dst: apNodeId,
          wave: waveNorm,
          agent: 'meta-process-auditor',
        });
      }
    }
  }

  // 4. File-touch edges from git log (wave nodes → file nodes)
  // Limit to files in scripts/ and docs/ that are materially tracked.
  // We do this for files that are referenced enough to matter.
  try {
    const gitLogOutput = execSync(
      'git log --pretty=format:"%s" --name-only --all',
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000 }
    );
    const lines = gitLogOutput.split('\n');
    let currentSubject = null;
    let currentWaveId = null;

    for (const line of lines) {
      if (!line.trim()) {
        currentSubject = null;
        currentWaveId = null;
        continue;
      }
      // Detect commit subject line (has no path separator in typical subjects)
      // Wave ID extraction: same regex as compute-dora.mjs
      const waveMatch = line.match(/wave-(\d+)(?:\.[RT]\d+)?/i);
      if (waveMatch && !line.includes('/') && line.length < 200) {
        // This is a commit subject, not a file path
        currentSubject = line;
        const num = parseInt(waveMatch[1], 10);
        currentWaveId = `wave-${String(num).padStart(3, '0')}`;
        const waveNodeId = `wave:${currentWaveId}`;
        ensureNode(waveNodeId, {
          kind: 'wave',
          label: currentWaveId,
          resolved: true,
          revisions: [],
        });
        // Capture revision suffix if present
        const revSuffix = line.match(/wave-\d+(\.[RT]\d+)/i);
        if (revSuffix) {
          const waveNode = nodesMap.get(waveNodeId);
          if (waveNode && !waveNode.revisions.includes(line.match(/wave-\d+\.[RT]\d+/i)?.[0])) {
            const fullRef = line.match(/wave-\d+\.[RT]\d+/i)?.[0];
            if (fullRef) waveNode.revisions.push(fullRef);
          }
        }
      } else if (currentWaveId && line.trim() && (line.startsWith('scripts/') || line.startsWith('docs/'))) {
        // This is a file path touched by the current wave commit
        const filePath = line.trim();
        const fileNodeId = `file:${filePath}`;
        if (!nodesMap.has(fileNodeId)) {
          const fileExists = fs.existsSync(path.join(ROOT, filePath));
          ensureNode(fileNodeId, {
            kind: 'file',
            label: filePath,
            resolved: fileExists,
            path: filePath,
          });
        }
        jsonEdges.push({
          src: `wave:${currentWaveId}`,
          rel: 'touched',
          dst: fileNodeId,
          wave: currentWaveId,
          agent: null,
        });
      }
    }
  } catch {
    process.stderr.write('[lineage-graph] WARN — git log failed; file-touch edges skipped\n');
  }

  const nodes = Array.from(nodesMap.values());

  return {
    nodes,
    edges: jsonEdges,
    meta: {
      _do_not_edit: true,
      built_at: new Date().toISOString(),
      wave_id_scheme: 'wave-NNN (3-digit zero-padded)',
      r2_normalization: 'wave-NNN.R2 collapsed to wave-NNN base ID; revision labels stored in revisions[]',
      mcp_boundary: 'This graph does not mirror live MCP entities. It covers only file-accessible governance surfaces: specs, ADRs, anti-patterns, waves, files. Memory snapshot staleness bound: last npm run memory:snapshot run.',
    },
  };
}

main();
