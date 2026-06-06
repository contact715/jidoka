#!/usr/bin/env node
/**
 * generate-arch-diagram.mjs — Wave-136 Living Architecture Diagrams.
 *
 * Reads the agent line-assignment table from docs/AGENT_ROSTER.md, groups agents
 * by IIA Three Lines classification, and emits a Mermaid graph TD with four
 * subgraphs (First / Second / Third / Support) to docs/governance/AGENT_TOPOLOGY.md.
 *
 * BOUNDARY NOTES (wave-136 D6 / D7):
 *   - This is NOT build-lineage-graph.mjs / wave-169 (_LINEAGE.md).
 *     wave-169 owns spec-lineage from YAML parents[]. This script owns
 *     agent-topology from AGENT_ROSTER.md. Different source, content, output.
 *   - This is NOT a replacement for the hand-authored diagrams in
 *     docs/archive/imported-product/AGENT_LAYER_ARCHITECTURE.md (erDiagram + sequenceDiagram at lines
 *     85-111 and 1423-1450). Those are different views requiring author judgment.
 *
 * Usage:
 *   node scripts/generate-arch-diagram.mjs           # write AGENT_TOPOLOGY.md
 *   node scripts/generate-arch-diagram.mjs --check   # drift gate: exit 1 if stale
 *
 * Exit codes:
 *   0  success (write mode) or PASS (check mode)
 *   1  FAIL (check mode: committed file drifted from fresh regeneration)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ROSTER_PATH = path.join(ROOT, 'docs', 'AGENT_ROSTER.md');
const OUT_PATH    = path.join(ROOT, 'docs', 'governance', 'AGENT_TOPOLOGY.md');

const isCheck = process.argv.includes('--check');

// ── Roster parser ─────────────────────────────────────────────────────────────
// Copied verbatim from scripts/check-cross-line-dispatch.mjs:72-106 (wave-154).
// Convention: copy-and-cite per validate-agent-access.mjs:63-67 pattern.
// DO NOT rewrite — a fourth independent parser adds drift risk (wave-136 D4).
function parseRoster() {
  const text = fs.readFileSync(ROSTER_PATH, 'utf8');
  const lines = text.split('\n');
  const roster = new Map(); // agent name (lowercase) -> line classification

  // Find the 30-agent table by looking for the header row
  let inTable = false;
  for (const line of lines) {
    if (line.includes('| Agent |') && line.includes('Line:')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      // Stop at next markdown heading or blank separator
      if (line.startsWith('#') || (line.startsWith('|') === false && line.trim() !== '' && !line.startsWith('|---'))) {
        break;
      }
      if (!line.startsWith('|') || line.startsWith('|---')) continue;

      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 3) {
        // Wave-136 AC-11 extension: if the line has at least an agent name but
        // the third column is missing or empty (filter(Boolean) removed it),
        // re-parse without filtering to capture the agent name for WARN reporting.
        const rawCells = line.split('|').map((c) => c.trim());
        // rawCells[0] is empty (before first |), rawCells[1] is agent name
        const rawAgent = rawCells[1] || '';
        if (rawAgent && rawAgent !== '---') {
          roster.set(rawAgent.toLowerCase(), { name: rawAgent, line: 'unknown' });
        }
        continue;
      }
      const agentName = cells[0];
      const lineValue = cells[2]; // e.g. "Line: First — Operations"

      let lineClass = 'unknown';
      if (lineValue.includes('First')) lineClass = 'First';
      else if (lineValue.includes('Second')) lineClass = 'Second';
      else if (lineValue.includes('Third')) lineClass = 'Third';
      else if (lineValue.includes('Pre-wave') || lineValue.includes('Support')) lineClass = 'Support';

      roster.set(agentName.toLowerCase(), { name: agentName, line: lineClass });
    }
  }
  return roster;
}
// ── End of copied parseRoster() ───────────────────────────────────────────────

/**
 * Sanitise an agent name into a Mermaid-safe node ID.
 * Mirrors build-lineage-graph.mjs:141-146 pattern: spaces → underscores,
 * strip characters that break Mermaid flowchart syntax.
 */
function sanitiseId(name) {
  return name
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '');
}

/**
 * Generate the full AGENT_TOPOLOGY.md content from the parsed roster.
 * Returns a string (not written to disk here — allows check mode to compare).
 */
function generateContent(roster) {
  const timestamp = new Date().toISOString();

  // Group agents by IIA line
  const groups = {
    First:   [],
    Second:  [],
    Third:   [],
    Support: [],
    unknown: [],
  };

  for (const entry of roster.values()) {
    const bucket = groups[entry.line] ?? groups.unknown;
    bucket.push(entry);
  }

  const warnAgents = groups.unknown;

  // Build Mermaid block
  const mermaidLines = [];
  mermaidLines.push('```mermaid');
  mermaidLines.push('graph TD');
  mermaidLines.push('');

  // Subgraph labels matching spec §3 data flow
  const subgraphDefs = [
    { key: 'First',   label: 'First Line — Operations' },
    { key: 'Second',  label: 'Second Line — Risk-Compliance' },
    { key: 'Third',   label: 'Third Line — Independent Audit' },
    { key: 'Support', label: 'Pre-wave / Support' },
  ];

  let totalNodes = 0;

  for (const { key, label } of subgraphDefs) {
    const agents = groups[key];
    mermaidLines.push(`  subgraph ${key} ["${label}"]`);
    if (agents.length === 0) {
      // Per AC-5 / REFLEXION-5: emit empty subgraph with comment so the line
      // remains visible even if temporarily unpopulated.
      mermaidLines.push(`    %% no agents currently assigned to this line`);
    } else {
      for (const agent of agents) {
        const id    = sanitiseId(agent.name);
        const label = agent.name;
        // Node format: ID["Label"] — Mermaid flowchart node with display text
        mermaidLines.push(`    ${id}["${label}"]`);
        totalNodes++;
      }
    }
    mermaidLines.push('  end');
    mermaidLines.push('');
  }

  mermaidLines.push('```');

  // Assemble the full file
  const outputLines = [];
  outputLines.push(`> Auto-generated by \`generate-arch-diagram.mjs\` from docs/AGENT_ROSTER.md — do not edit manually. Last update: ${timestamp}`);
  outputLines.push('');
  outputLines.push('# Agent Topology');
  outputLines.push('');
  outputLines.push('IIA Three Lines agent topology, generated from the structured table in `docs/AGENT_ROSTER.md`.');
  outputLines.push('Run `npm run arch:topology` to regenerate. Run `npm run arch:check` to verify the committed file is current.');
  outputLines.push('');
  outputLines.push('See also:');
  outputLines.push('- `docs/AGENT_ROSTER.md` — canonical agent definitions and line assignments (source of truth)');
  outputLines.push('- `docs/archive/imported-product/AGENT_LAYER_ARCHITECTURE.md` — hand-authored ER and sequence diagrams (archived product example)');
  outputLines.push('- `docs/specs/_LINEAGE.md` — spec-ancestry lineage (wave-169 domain, different source)');
  outputLines.push('');
  outputLines.push(...mermaidLines);
  outputLines.push('');

  return { content: outputLines.join('\n'), totalNodes, warnAgents };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const roster = parseRoster();
const agentCount = roster.size;

const { content, totalNodes, warnAgents } = generateContent(roster);

// AC-11: warn on any agent with no Line: annotation (lineClass === 'unknown')
if (warnAgents.length > 0) {
  process.stdout.write(`[arch] [WARN] ${warnAgents.length} agent(s) have no Line: annotation in AGENT_ROSTER.md:\n`);
  for (const a of warnAgents) {
    process.stdout.write(`  - ${a.name}\n`);
  }
  process.stdout.write(`[arch] [WARN] These agents are omitted from the topology diagram. Add a Line: column value to fix.\n`);
}

if (isCheck) {
  // ── Check mode: compare buffer vs committed file ───────────────────────────
  // Mirrors generate-api-types.mjs:142-155 drift-gate skeleton exactly.
  let committed;
  try {
    committed = fs.readFileSync(OUT_PATH, 'utf8');
  } catch (err) {
    process.stderr.write(
      `[arch] [FAIL] Cannot read committed file at ${OUT_PATH}\n  ${err.message}\n`
    );
    process.stderr.write(
      `[arch] Hint: run \`npm run arch:topology\` to create the initial file.\n`
    );
    process.exit(1);
  }

  // Normalize timestamps for a stable comparison — the "Last update: <ISO>" line
  // changes on every run; strip it before comparing (same pattern as generate-api-types.mjs:160).
  const normalize = (s) => s.replace(/Last update: [^\n]+/g, 'Last update: <NORMALIZED>');

  if (normalize(content) === normalize(committed)) {
    process.stdout.write(
      `[arch] [PASS] Committed AGENT_TOPOLOGY.md matches fresh regeneration.\n` +
      `[arch] ${agentCount} agents parsed, ${totalNodes} nodes, 4 subgraphs.\n`
    );
    process.exit(0);
  } else {
    process.stdout.write(
      `[arch] [FAIL] Committed AGENT_TOPOLOGY.md is STALE — it does not match a fresh regeneration.\n` +
      `[arch] Run \`npm run arch:topology\` to update the committed file, then re-commit.\n` +
      `[arch] ${agentCount} agents parsed, ${totalNodes} nodes in fresh output.\n`
    );
    process.exit(1);
  }
} else {
  // ── Write mode ─────────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, content, 'utf8');
  process.stdout.write(
    `[arch] Wrote ${OUT_PATH}\n` +
    `[arch] ${agentCount} agents parsed, ${totalNodes} nodes emitted, 4 subgraphs.\n`
  );
}
