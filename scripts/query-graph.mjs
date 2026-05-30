#!/usr/bin/env node
/**
 * Wave-169 — Knowledge Graph Query CLI
 *
 * Thin CLI over docs/specs/_LINEAGE.json (materialized by kg:build).
 * Uses live git log for waves-touching (avoids staleness on highest-value query).
 * DFS traversal reuses the buildAdjacencyMap + transitiveClosure pattern from
 * scripts/cascade-validate.mjs (inline — no fork allowed per spec D1 constraints).
 *
 * Usage:
 *   node scripts/query-graph.mjs waves-touching <file-path>
 *   node scripts/query-graph.mjs lineage <spec-path> [<ancestor-path>]
 *   node scripts/query-graph.mjs supersedes <adr-id>
 *   node scripts/query-graph.mjs anti-patterns-of <wave-id>
 *
 * Unresolved nodes are surfaced with [UNRESOLVED] prefix — never silently dropped.
 * Output: JSON to stdout by default; --table for human-readable tabular format.
 *
 * MCP boundary: this script does NOT call mcp__memory__* (D7 invariant).
 * Regenerate-from-source: run kg:build before querying to refresh _LINEAGE.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonlStream } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LINEAGE_JSON = path.join(ROOT, 'docs/specs/_LINEAGE.json');
const AGENT_EVENTS_PATH = path.join(ROOT, 'docs/audits/agent-events.jsonl');
const AP_FILE = path.join(ROOT, 'docs/memory-anti-patterns.md');

const args = process.argv.slice(2);
const subcommand = args[0];
const arg1 = args[1];
const isTable = args.includes('--table');

// ── Wave-169: ID normalization ─────────────────────────────────────────
// Canonical wave ID: wave-NNN (3-digit zero-padded).
// Strips .R2/.R3/.Tn suffixes and -slug suffixes.
const WAVE_NORM_RE = /wave-(\d+)/i;

function normalizeWaveId(raw) {
  if (!raw) return null;
  const m = String(raw).match(WAVE_NORM_RE);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  return `wave-${String(num).padStart(3, '0')}`;
}

// ── Load materialized graph ────────────────────────────────────────────
function loadGraph() {
  if (!fs.existsSync(LINEAGE_JSON)) {
    process.stdout.write(
      `⊘ DORMANT — ${LINEAGE_JSON} not seeded yet; knowledge-graph queries inactive, not failed.\n` +
      `  Seed it: node scripts/build-lineage-graph.mjs --json\n`
    );
    process.exit(0);
  }
  try {
    return JSON.parse(fs.readFileSync(LINEAGE_JSON, 'utf8'));
  } catch (e) {
    process.stderr.write(`[query-graph] ERROR — failed to parse _LINEAGE.json: ${e}\n`);
    process.exit(1);
  }
}

// ── DFS traversal (reuses cascade-validate.mjs pattern inline) ────────
// Build adjacency map: nodeId → [{ dstId, rel, edge }]
function buildAdjacencyMap(edges) {
  const map = new Map();
  for (const edge of edges) {
    if (!map.has(edge.src)) map.set(edge.src, []);
    map.get(edge.src).push({ dstId: edge.dst, rel: edge.rel, edge });
  }
  return map;
}

// Build reverse adjacency map: dstId → [{ srcId, rel, edge }]
function buildReverseAdjacencyMap(edges) {
  const map = new Map();
  for (const edge of edges) {
    if (!map.has(edge.dst)) map.set(edge.dst, []);
    map.get(edge.dst).push({ srcId: edge.src, rel: edge.rel, edge });
  }
  return map;
}

// BFS ancestry traversal (child → parents via forward adjacency)
// edges are src=child, dst=parent, so forward adjacency gives ancestors
function ancestorClosureFiltered(startId, fwdAdjMap, allowedRels) {
  const visited = new Set();
  const queue = [{ id: startId, depth: 0, via: null, rel: null }];
  const results = [];
  visited.add(startId);

  while (queue.length > 0) {
    const { id, depth } = queue.shift();

    const outEdges = fwdAdjMap.get(id) ?? [];
    for (const { dstId, rel } of outEdges) {
      // Only follow lineage-type edges for ancestor traversal
      if (allowedRels && !allowedRels.has(rel)) continue;
      if (!visited.has(dstId)) {
        visited.add(dstId);
        results.push({ id: dstId, depth: depth + 1, rel, via: id });
        queue.push({ id: dstId, depth: depth + 1, via: id, rel });
      }
    }
  }

  return results;
}

// BFS from DST to SRC (reverse: what points to this node)
function ancestorClosure(startId, reverseAdjMap) {
  const visited = new Set();
  const queue = [{ id: startId, depth: 0, via: null }];
  const results = [];

  while (queue.length > 0) {
    const { id, depth, via } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);

    const parents = reverseAdjMap.get(id) ?? [];
    for (const { srcId, rel } of parents) {
      if (!visited.has(srcId)) {
        results.push({ id: srcId, depth: depth + 1, rel, via: id });
        queue.push({ id: srcId, depth: depth + 1, via: id });
      }
    }
  }

  return results;
}

// ── Node lookup helper ─────────────────────────────────────────────────
function findNode(nodes, id) {
  return nodes.find(n => n.id === id) ?? null;
}

function formatNodeId(node) {
  if (!node) return '[UNRESOLVED]';
  if (!node.resolved) return `[UNRESOLVED] ${node.id} (${node.path ?? 'unknown path'})`;
  return node.id;
}

// ── Subcommand: waves-touching <file> ─────────────────────────────────
// Uses live git log (avoids staleness) + JSONL streams for additional coverage.
// Must return wave-147 for scripts/emit-telemetry.mjs (AC-5, AC-15).
function cmdWavesTouching(filePath) {
  if (!filePath) {
    process.stderr.write('[query-graph] ERROR — waves-touching requires a file path argument\n');
    process.exit(1);
  }

  const waveSet = new Map(); // waveId → { id, date, source, agent }

  // 1. Live git log — most reliable source
  try {
    const gitOut = execSync(
      `git log --pretty=format:"%s|||%ad|||%an" --date=short --all -- "${filePath}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000 }
    );
    for (const line of gitOut.split('\n')) {
      if (!line.trim()) continue;
      const [subject, date, author] = line.split('|||');
      const waveMatch = subject?.match(/wave-(\d+)/i);
      if (waveMatch) {
        const waveId = normalizeWaveId(`wave-${waveMatch[1]}`);
        if (waveId && !waveSet.has(waveId)) {
          waveSet.set(waveId, { id: waveId, date: date?.trim() ?? null, source: 'git-log', agent: author?.trim() ?? null });
        }
      }
    }
  } catch {
    process.stderr.write('[query-graph] WARN — git log failed; falling back to JSONL only\n');
  }

  // 2. Supplement with JSONL agent-events (source field matches file path)
  // This catches wave-147 records that have source: scripts/emit-telemetry.mjs
  const normalizedQueryPath = filePath.replace(/^\.\//, '');
  const events = readJsonlStream(AGENT_EVENTS_PATH);
  for (const ev of events) {
    const evSource = (ev.source ?? '').replace(/^\.\//, '');
    const evWaveRaw = ev.wave ?? null;
    if (evSource === normalizedQueryPath && evWaveRaw) {
      const waveId = normalizeWaveId(evWaveRaw);
      if (waveId && !waveSet.has(waveId)) {
        waveSet.set(waveId, {
          id: waveId,
          date: ev.time ? ev.time.slice(0, 10) : null,
          source: 'agent-events.jsonl',
          agent: ev.agent ?? null,
        });
      }
    }
  }

  // 3. Also check all other JSONL streams for source references
  const allJsonlFiles = fs.readdirSync(path.join(ROOT, 'docs/audits'))
    .filter(f => f.endsWith('.jsonl') && f !== 'agent-events.jsonl');
  for (const jFile of allJsonlFiles) {
    const jPath = path.join(ROOT, 'docs/audits', jFile);
    const jEvents = readJsonlStream(jPath);
    for (const ev of jEvents) {
      const evSource = (ev.source ?? '').replace(/^\.\//, '');
      const evWaveRaw = ev.wave ?? null;
      if (evSource === normalizedQueryPath && evWaveRaw) {
        const waveId = normalizeWaveId(evWaveRaw);
        if (waveId && !waveSet.has(waveId)) {
          waveSet.set(waveId, {
            id: waveId,
            date: ev.time ? ev.time.slice(0, 10) : null,
            source: jFile,
            agent: ev.agent ?? null,
          });
        }
      }
    }
  }

  // 4. Supplement from materialized _LINEAGE.json touched edges (if available)
  if (fs.existsSync(LINEAGE_JSON)) {
    try {
      const graph = loadGraph();
      const fileNodeId = `file:${normalizedQueryPath}`;
      for (const edge of graph.edges) {
        if (edge.rel === 'touched' && edge.dst === fileNodeId) {
          const waveId = normalizeWaveId(edge.wave ?? edge.src);
          if (waveId && !waveSet.has(waveId)) {
            waveSet.set(waveId, {
              id: waveId,
              date: null,
              source: '_LINEAGE.json',
              agent: edge.agent ?? null,
            });
          }
        }
      }
    } catch {
      // Non-fatal — git log is the primary source
    }
  }

  const results = Array.from(waveSet.values()).sort((a, b) => a.id.localeCompare(b.id));

  if (isTable) {
    process.stdout.write(`waves-touching: ${filePath}\n`);
    process.stdout.write(`${'Wave'.padEnd(12)} ${'Date'.padEnd(12)} ${'Source'.padEnd(20)} Agent\n`);
    process.stdout.write(`${'-'.repeat(12)} ${'-'.repeat(12)} ${'-'.repeat(20)} ${'-'.repeat(20)}\n`);
    for (const r of results) {
      process.stdout.write(`${r.id.padEnd(12)} ${(r.date ?? '').padEnd(12)} ${(r.source ?? '').padEnd(20)} ${r.agent ?? ''}\n`);
    }
  } else {
    process.stdout.write(JSON.stringify({ query: 'waves-touching', file: filePath, results }, null, 2) + '\n');
  }
}

// ── Subcommand: lineage <spec-path> [<ancestor>] ──────────────────────
// Returns transitive ancestor chain for a spec.
// Edge convention: src=child, rel=parent-of/implements/extends, dst=parent.
// So to find ancestors we follow FORWARD edges (forward adjacency src → dst).
// Unresolved parents are surfaced with [UNRESOLVED] prefix.
function cmdLineage(specPath, ancestorFilter) {
  if (!specPath) {
    process.stderr.write('[query-graph] ERROR — lineage requires a spec path argument\n');
    process.exit(1);
  }

  const graph = loadGraph();
  // Use forward adjacency: src → [dst] to traverse parent chain
  const fwdAdj = buildAdjacencyMap(graph.edges);

  // Normalize: strip leading ./ and prefix with spec: if no scheme
  const normalizedPath = specPath.replace(/^\.\//, '');
  const startId = normalizedPath.includes(':') ? normalizedPath : `spec:${normalizedPath}`;

  const startNode = findNode(graph.nodes, startId);
  if (!startNode) {
    process.stderr.write(`[query-graph] WARN — no node found for "${startId}" in _LINEAGE.json\n`);
    process.stderr.write(`  Run kg:build to refresh the graph.\n`);
  }

  // BFS over parent-of / implements / extends edges (lineage relationship types)
  const LINEAGE_RELS = new Set(['parent-of', 'implements', 'extends', 'sibling', 'uses', 'serves']);
  const ancestors = ancestorClosureFiltered(startId, fwdAdj, LINEAGE_RELS);

  const results = ancestors.map(({ id, depth, rel }) => {
    const node = findNode(graph.nodes, id);
    return {
      id,
      depth,
      rel,
      label: node?.label ?? null,
      resolved: node?.resolved ?? false,
      kind: node?.kind ?? 'unknown',
      display: node?.resolved === false ? `[UNRESOLVED] ${id}` : id,
    };
  });

  // Filter by ancestor if specified
  const filtered = ancestorFilter
    ? results.filter(r => r.id.includes(ancestorFilter) || (r.label ?? '').includes(ancestorFilter))
    : results;

  // Wave-169 R2 fix: detect "other edges exist" when lineage is empty.
  // Prevents silent empty exit 0 when relevant edges (supersedes, belongs-to, etc.) exist.
  // Strategy: option (b) — print an explicit advisory instead of returning silent empty.
  let otherEdgeAdvisory = null;
  if (results.length === 0) {
    const allOutEdges = graph.edges.filter(e => e.src === startId);
    const nonLineageEdges = allOutEdges.filter(e => !LINEAGE_RELS.has(e.rel));
    if (nonLineageEdges.length > 0) {
      const byRel = {};
      for (const e of nonLineageEdges) {
        byRel[e.rel] = (byRel[e.rel] ?? 0) + 1;
      }
      const summary = Object.entries(byRel)
        .map(([rel, count]) => `${count} ${rel} edge(s)`)
        .join(', ');
      otherEdgeAdvisory = `no parent/extends lineage edges found; ${summary} exist — use the appropriate subcommand (e.g. 'supersedes') to query those relationships`;
    }
  }

  if (isTable) {
    process.stdout.write(`lineage: ${specPath}\n`);
    if (otherEdgeAdvisory) {
      process.stdout.write(`NOTE: ${otherEdgeAdvisory}\n`);
    } else {
      process.stdout.write(`${'Depth'.padEnd(7)} ${'Relation'.padEnd(15)} ${'Node ID'}\n`);
      process.stdout.write(`${'-'.repeat(7)} ${'-'.repeat(15)} ${'-'.repeat(40)}\n`);
      for (const r of results) {
        process.stdout.write(`${String(r.depth).padEnd(7)} ${(r.rel ?? '').padEnd(15)} ${r.display}\n`);
      }
    }
    if (filtered.length < results.length) {
      process.stdout.write(`\nAncestor match for "${ancestorFilter}": ${filtered.length} result(s)\n`);
      for (const r of filtered) {
        process.stdout.write(`  depth=${r.depth} ${r.display}\n`);
      }
    }
  } else {
    process.stdout.write(JSON.stringify({
      query: 'lineage',
      spec: specPath,
      ancestor_filter: ancestorFilter ?? null,
      start_node: startNode ? { id: startId, label: startNode.label, resolved: startNode.resolved } : { id: startId, label: null, resolved: false },
      ancestors: results,
      filtered_ancestors: ancestorFilter ? filtered : undefined,
      advisory: otherEdgeAdvisory ?? undefined,
    }, null, 2) + '\n');
  }
}

// ── Subcommand: supersedes <adr-id> ───────────────────────────────────
// Returns the ADR(s) that this ADR supersedes, or ADRs that supersede it.
function cmdSupersedes(adrId) {
  if (!adrId) {
    process.stderr.write('[query-graph] ERROR — supersedes requires an ADR id argument (e.g. ADR-006)\n');
    process.exit(1);
  }

  const graph = loadGraph();

  // Normalize ADR id: strip leading adr: if present, normalize number
  const bare = adrId.replace(/^adr:/i, '').toUpperCase();
  const numM = bare.match(/ADR-(\d+)/i);
  const adrNum = numM ? String(parseInt(numM[1], 10)).padStart(3, '0') : null;
  const normalizedAdrId = adrNum ? `adr:ADR-${adrNum}` : `adr:${bare}`;

  // Find all supersedes edges where src === this ADR (what does it supersede?)
  const supersededByThis = graph.edges.filter(
    e => e.rel === 'supersedes' && (e.src === normalizedAdrId || e.src === `spec:docs/decisions/${bare}.md`)
  );

  // Find all supersedes edges where dst === this ADR (what supersedes it?)
  const supersedingThis = graph.edges.filter(
    e => e.rel === 'supersedes' && (e.dst === normalizedAdrId || e.dst === `spec:docs/decisions/${bare}.md`)
  );

  const results = {
    query: 'supersedes',
    adr: adrId,
    normalized_id: normalizedAdrId,
    superseded_by_this: supersededByThis.map(e => {
      const node = findNode(graph.nodes, e.dst);
      return {
        id: e.dst,
        label: node?.label ?? null,
        resolved: node?.resolved ?? false,
        display: node?.resolved === false ? `[UNRESOLVED] ${e.dst}` : e.dst,
      };
    }),
    superseded_by_other: supersedingThis.map(e => {
      const node = findNode(graph.nodes, e.src);
      return {
        id: e.src,
        label: node?.label ?? null,
        resolved: node?.resolved ?? false,
        display: node?.resolved === false ? `[UNRESOLVED] ${e.src}` : e.src,
      };
    }),
    message: supersededByThis.length === 0 && supersedingThis.length === 0
      ? `no supersedes relationship found for ${adrId}`
      : null,
  };

  if (isTable) {
    process.stdout.write(`supersedes: ${adrId}\n`);
    if (supersededByThis.length > 0) {
      process.stdout.write(`This ADR supersedes:\n`);
      for (const r of results.superseded_by_this) {
        process.stdout.write(`  ${r.display}\n`);
      }
    }
    if (supersedingThis.length > 0) {
      process.stdout.write(`This ADR is superseded by:\n`);
      for (const r of results.superseded_by_other) {
        process.stdout.write(`  ${r.display}\n`);
      }
    }
    if (results.message) {
      process.stdout.write(`  ${results.message}\n`);
    }
  } else {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  }
}

// ── Subcommand: anti-patterns-of <wave-id> ────────────────────────────
// Returns anti-patterns attributed to a wave.
// Sources: (1) docs/memory-anti-patterns.md table (primary), (2) agent-events.jsonl slugs.
function cmdAntiPatternsOf(waveArg) {
  if (!waveArg) {
    process.stderr.write('[query-graph] ERROR — anti-patterns-of requires a wave id argument\n');
    process.exit(1);
  }

  const waveNorm = normalizeWaveId(waveArg);
  if (!waveNorm) {
    process.stderr.write(`[query-graph] ERROR — could not normalize wave id: ${waveArg}\n`);
    process.exit(1);
  }

  const antiPatterns = new Map(); // slug → { slug, label, source, wave }

  // 1. docs/memory-anti-patterns.md — table parse
  if (fs.existsSync(AP_FILE)) {
    const apContent = fs.readFileSync(AP_FILE, 'utf8');
    const tableRowRe = /^\|\s*`([^`]+)`\s*\|\s*AntiPattern\s*\|\s*[^|]+\|\s*([^|]+)\|/gm;
    for (const m of apContent.matchAll(tableRowRe)) {
      const slug = m[1].trim();
      const waveRaw = m[2].trim();
      const waveForRow = normalizeWaveId(waveRaw);
      if (waveForRow === waveNorm) {
        antiPatterns.set(slug, { slug, label: slug, source: 'memory-anti-patterns.md', wave: waveNorm });
      }
    }

    // Also parse entity detail sections: **Wave**: wave-145
    const entityRe = /^###\s+`([^`]+)`[\s\S]*?\*\*Wave\*\*:\s*([^\n]+)/gm;
    for (const m of apContent.matchAll(entityRe)) {
      const slug = m[1].trim();
      const waveRaw = m[2].trim();
      const waveForRow = normalizeWaveId(waveRaw);
      if (waveForRow === waveNorm && !antiPatterns.has(slug)) {
        antiPatterns.set(slug, { slug, label: slug, source: 'memory-anti-patterns.md (entity)', wave: waveNorm });
      }
    }
  }

  // 2. docs/audits/agent-events.jsonl — meta_process_regression with slugs payload
  const events = readJsonlStream(AGENT_EVENTS_PATH);
  for (const ev of events) {
    if (ev.event_type !== 'meta_process_regression') continue;
    const evWaveRaw = ev.wave ?? null;
    const evWaveNorm = normalizeWaveId(evWaveRaw);
    if (evWaveNorm !== waveNorm) continue;
    const slugs = ev.payload?.slugs ?? [];
    for (const slug of slugs) {
      const fullSlug = slug.startsWith('anti-pattern-') ? slug : `anti-pattern-${slug}`;
      if (!antiPatterns.has(fullSlug)) {
        antiPatterns.set(fullSlug, {
          slug: fullSlug,
          label: fullSlug,
          source: 'agent-events.jsonl',
          wave: waveNorm,
        });
      }
    }
  }

  // 3. Supplement from _LINEAGE.json triggered edges
  if (fs.existsSync(LINEAGE_JSON)) {
    try {
      const graph = loadGraph();
      const waveNodeId = `wave:${waveNorm}`;
      for (const edge of graph.edges) {
        if (edge.rel === 'triggered' && edge.src === waveNodeId) {
          const node = findNode(graph.nodes, edge.dst);
          const slug = node?.slug ?? edge.dst.replace('anti-pattern:', '');
          if (!antiPatterns.has(slug)) {
            antiPatterns.set(slug, {
              slug,
              label: node?.label ?? slug,
              source: '_LINEAGE.json',
              wave: waveNorm,
              resolved: node?.resolved ?? false,
            });
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  const results = Array.from(antiPatterns.values());

  if (isTable) {
    process.stdout.write(`anti-patterns-of: ${waveArg} (normalized: ${waveNorm})\n`);
    if (results.length === 0) {
      process.stdout.write(`  no anti-patterns found for ${waveNorm}\n`);
    } else {
      process.stdout.write(`${'Slug'.padEnd(50)} Source\n`);
      process.stdout.write(`${'-'.repeat(50)} ${'-'.repeat(25)}\n`);
      for (const r of results) {
        process.stdout.write(`${r.slug.padEnd(50)} ${r.source}\n`);
      }
    }
  } else {
    process.stdout.write(JSON.stringify({
      query: 'anti-patterns-of',
      wave: waveArg,
      normalized: waveNorm,
      results,
    }, null, 2) + '\n');
  }
}

// ── Main dispatch ──────────────────────────────────────────────────────
if (!subcommand) {
  process.stderr.write(
    'Usage: node scripts/query-graph.mjs <subcommand> [args] [--table]\n\n' +
    'Subcommands:\n' +
    '  waves-touching <file-path>     — waves that touched a file\n' +
    '  lineage <spec-path>            — transitive ancestor chain\n' +
    '  supersedes <adr-id>            — ADR supersedes relationships\n' +
    '  anti-patterns-of <wave-id>     — anti-patterns attributed to a wave\n\n' +
    'Options:\n' +
    '  --table                        — human-readable tabular output\n\n' +
    'Run kg:build before querying to ensure _LINEAGE.json is fresh.\n'
  );
  process.exit(1);
}

switch (subcommand) {
  case 'waves-touching':
    cmdWavesTouching(arg1);
    break;
  case 'lineage':
    cmdLineage(arg1, args[2]);
    break;
  case 'supersedes':
    cmdSupersedes(arg1);
    break;
  case 'anti-patterns-of':
    cmdAntiPatternsOf(arg1);
    break;
  default:
    process.stderr.write(
      `[query-graph] ERROR — unknown subcommand: "${subcommand}"\n` +
      `  Valid: waves-touching, lineage, supersedes, anti-patterns-of\n`
    );
    process.exit(1);
}
