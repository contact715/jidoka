#!/usr/bin/env node
// @ts-check
/**
 * Wave-185 — Zero-Trust Agent Access Model Validator
 *
 * Reads docs/governance/agent-access-registry.json, cross-references each
 * entry against its .claude/agents/*.md tools: frontmatter, applies three
 * invariants, and exits 0/1.
 *
 * Invariants:
 *   I0 — Grant-drift: registry declared_tools must match .md tools: frontmatter
 *         exactly (order-insensitive). Any mismatch = GRANT-DRIFT finding.
 *   I1 — Tier A OVER-PRIVILEGE (severity HIGH): agent is Second/Third Line AND
 *         holds Write/Edit AND has no declared write_scope AND its description
 *         contains a scope-contradicting phrase ("never touches product code",
 *         "never writes product code", "does not fix", "read-only").
 *         Exit 1 on any I1 finding.
 *   I2 — Tier B UNSCOPED-WRITE (severity MEDIUM): any agent with Write/Edit in
 *         declared_tools AND write_scope is null. Does not trigger exit 1 alone.
 *
 * REUSE: parseRoster / buildSlugToRoster / isAgentSlug verbatim from
 *        scripts/validate-raci.mjs:57-118 (wave-170 pattern).
 *
 * Findings are ranked by blast_radius (critical > medium > low) before printing.
 * Each finding is appended as JSONL to docs/audits/agent-access-verdicts.jsonl.
 *
 * Exit codes:
 *   0 — PASS (all I1 findings resolved; I2 warnings do not block)
 *   1 — VIOLATION (any I1 finding present, or I0 grant-drift found)
 *
 * Usage:
 *   node scripts/validate-agent-access.mjs
 *   npm run agent:access
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ──────────────────────────────────────────────────────────────────
const REGISTRY_PATH = path.join(ROOT, 'docs', 'governance', 'agent-access-registry.json');
const ROSTER_PATH = path.join(ROOT, 'docs', 'AGENT_ROSTER.md');
const AGENTS_DIR = path.join(ROOT, '.claude', 'agents');
const VERDICTS_PATH = path.join(ROOT, 'docs', 'audits', 'agent-access-verdicts.jsonl');

// ── Scope-contradicting phrases for I1 detection ───────────────────────────
const SCOPE_CONTRADICTING_PHRASES = [
  'never touches product code',
  'never writes product code',
  'does not write product code',
  'does not fix',
  'read-only',
  'never modifies files',
];

// ── Blast radius ordering ──────────────────────────────────────────────────
const BLAST_RADIUS_ORDER = { critical: 3, medium: 2, low: 1 };

// ── REUSE: parseRoster from validate-raci.mjs:57-82 ───────────────────────
// Reads the agent table from docs/AGENT_ROSTER.md.
// Table format: | Agent | L-tier | Line: |
// Returns a Set of normalized (lowercase) agent name slugs.
function parseRoster() {
  const text = fs.readFileSync(ROSTER_PATH, 'utf8');
  const lines = text.split('\n');
  const rosterNames = new Set(); // lowercase agent name

  let inTable = false;
  for (const line of lines) {
    if (line.includes('| Agent |') && line.includes('Line:')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (
        line.startsWith('#') ||
        (line.startsWith('|') === false && line.trim() !== '' && !line.startsWith('|---'))
      ) {
        break;
      }
      if (!line.startsWith('|') || line.startsWith('|---')) continue;
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 1) continue;
      rosterNames.add(cells[0].toLowerCase());
    }
  }
  return rosterNames;
}

// ── REUSE: buildSlugToRoster from validate-raci.mjs:84-101 ────────────────
// raci.json uses kebab-case slugs; AGENT_ROSTER.md has mixed-case names.
// Build a lookup from slug → roster name for validation.
function buildSlugToRoster(rosterNames) {
  const map = new Map(); // slug -> lowercased roster entry
  for (const name of rosterNames) {
    // exact lowercase
    map.set(name, name);
    // kebab slug: replace spaces with dashes
    const kebab = name.replace(/\s+/g, '-');
    map.set(kebab, name);
    // also strip all separators for fuzzy match
    const flat = name.replace(/[\s\-]/g, '');
    map.set(flat, name);
  }
  return map;
}

// ── REUSE: isAgentSlug from validate-raci.mjs:103-109 ────────────────────
// Returns true if the slug IS a known agent in the roster.
function isAgentSlug(slug, slugMap) {
  if (typeof slug !== 'string') return false;
  const lower = slug.toLowerCase();
  return slugMap.has(lower);
}

// ── Parse agent line from roster text ─────────────────────────────────────
// Returns the IIA line for a given agent slug: "Second", "Third", or "First".
function getAgentLine(slug, rosterText) {
  const lines = rosterText.split('\n');
  let inTable = false;
  for (const line of lines) {
    if (line.includes('| Agent |') && line.includes('Line:')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (
        line.startsWith('#') ||
        (line.startsWith('|') === false && line.trim() !== '' && !line.startsWith('|---'))
      ) {
        break;
      }
      if (!line.startsWith('|') || line.startsWith('|---')) continue;
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 3) continue;
      const agentName = cells[0].toLowerCase();
      const lineCell = cells[2]; // "Line: Second — Risk-Compliance"
      // normalize slug for comparison
      const normalized = slug.replace(/[\s\-]/g, '').toLowerCase();
      const agentNormalized = agentName.replace(/[\s\-]/g, '');
      if (agentNormalized === normalized || agentName === slug.toLowerCase()) {
        return lineCell; // full line string
      }
    }
  }
  return null;
}

// ── Parse tools: from agent .md frontmatter ────────────────────────────────
// Returns an array of tool names from the tools: line, or null if not found.
function parseAgentToolsFromMd(slug) {
  // Try exact filename match first
  const exactPath = path.join(AGENTS_DIR, `${slug}.md`);
  if (fs.existsSync(exactPath)) {
    return extractToolsFromFile(exactPath);
  }
  // Try with spaces replaced by hyphens
  const kebabPath = path.join(AGENTS_DIR, `${slug.replace(/\s+/g, '-')}.md`);
  if (fs.existsSync(kebabPath)) {
    return extractToolsFromFile(kebabPath);
  }
  // Orchestrator, CPO, CIO are L0/L0.5 agents without dedicated .md files
  return null;
}

function extractToolsFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let inFrontmatter = false;
  let frontmatterStarted = false;
  for (const line of lines) {
    if (line.trim() === '---') {
      if (!frontmatterStarted) {
        frontmatterStarted = true;
        inFrontmatter = true;
        continue;
      } else {
        break; // end of frontmatter
      }
    }
    if (inFrontmatter && line.startsWith('tools:')) {
      const toolsStr = line.replace(/^tools:\s*/, '').trim();
      if (!toolsStr) return [];
      return toolsStr.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }
  return null; // no tools: line found
}

// ── Parse agent description from .md ──────────────────────────────────────
function parseAgentDescription(slug) {
  const exactPath = path.join(AGENTS_DIR, `${slug}.md`);
  const kebabPath = path.join(AGENTS_DIR, `${slug.replace(/\s+/g, '-')}.md`);
  const filePath = fs.existsSync(exactPath) ? exactPath : (fs.existsSync(kebabPath) ? kebabPath : null);
  if (!filePath) return '';

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let inFrontmatter = false;
  let frontmatterStarted = false;
  for (const line of lines) {
    if (line.trim() === '---') {
      if (!frontmatterStarted) {
        frontmatterStarted = true;
        inFrontmatter = true;
        continue;
      } else {
        break;
      }
    }
    if (inFrontmatter && line.startsWith('description:')) {
      return line.replace(/^description:\s*/, '').trim().toLowerCase();
    }
  }
  // Also check body text for scope-contradicting phrases
  return content.toLowerCase();
}

// ── Check if description contains scope-contradicting phrase ──────────────
function hasScopeContradictingPhrase(slug) {
  const desc = parseAgentDescription(slug);
  for (const phrase of SCOPE_CONTRADICTING_PHRASES) {
    if (desc.includes(phrase)) return phrase;
  }
  return null;
}

// ── Determine if line is Second or Third ──────────────────────────────────
function isSecondOrThirdLine(lineStr) {
  if (!lineStr) return false;
  const l = lineStr.toLowerCase();
  return l.includes('second') || l.includes('third');
}

// ── Append finding to agent-access-verdicts.jsonl ─────────────────────────
function appendVerdict(finding) {
  const line = JSON.stringify(finding) + '\n';
  fs.appendFileSync(VERDICTS_PATH, line, 'utf8');
}

// ── Sort findings by blast_radius descending ──────────────────────────────
function sortByBlastRadius(findings) {
  return findings.slice().sort((a, b) => {
    const ra = BLAST_RADIUS_ORDER[a.blast_radius] || 0;
    const rb = BLAST_RADIUS_ORDER[b.blast_radius] || 0;
    return rb - ra;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
function main() {
  // Load registry
  if (!fs.existsSync(REGISTRY_PATH)) {
    process.stderr.write(`[validate-agent-access] ERROR: ${REGISTRY_PATH} not found.\n`);
    process.exit(1);
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (err) {
    process.stderr.write(`[validate-agent-access] ERROR: Failed to parse agent-access-registry.json: ${err.message}\n`);
    process.exit(1);
  }

  // Load roster for slug validation
  let rosterText;
  try {
    rosterText = fs.readFileSync(ROSTER_PATH, 'utf8');
  } catch (err) {
    process.stderr.write(`[validate-agent-access] ERROR: Failed to read AGENT_ROSTER.md: ${err.message}\n`);
    process.exit(1);
  }

  const rosterNames = parseRoster();
  const slugMap = buildSlugToRoster(rosterNames);

  const agents = registry.agents || [];
  const findings = [];
  const timestamp = new Date().toISOString();
  const wave = 'wave-185';

  // ── Invariant checks ───────────────────────────────────────────────────
  for (const entry of agents) {
    const slug = entry.slug;
    const declaredTools = entry.declared_tools || [];
    const writeScope = entry.write_scope;
    const blastRadius = entry.blast_radius || 'low';
    const llm06Category = entry.llm06_category || 'none';
    const lineStr = entry.line || '';

    // Skip L0/L0.5 agents without dedicated .md files (Orchestrator, CPO, CIO)
    const L0_AGENTS = ['orchestrator', 'chief-product-officer', 'competitive-intelligence-officer'];
    const isL0Agent = L0_AGENTS.includes(slug);

    // ── I0 — Grant-drift check ─────────────────────────────────────────
    if (!isL0Agent) {
      const actualTools = parseAgentToolsFromMd(slug);
      if (actualTools === null) {
        // .md file has no frontmatter tools: line (older-format agents like
        // proactive-surfacing-agent and pre-mortem-agent use body-only format).
        // If declared_tools is also [] (empty), both sources agree: no grant declared.
        // Only flag a drift if the registry declares non-empty tools but .md has none.
        if (declaredTools.length > 0) {
          findings.push({
            invariant: 'I0',
            severity: 'HIGH',
            slug,
            description: `GRANT-DRIFT: .md file for "${slug}" has no frontmatter tools: line, but registry declares [${declaredTools.join(', ')}]. Verify .md tools grant.`,
            declared: declaredTools,
            actual: null,
            blast_radius: blastRadius,
            llm06_category: llm06Category,
            timestamp,
            wave,
          });
        }
        // If both are empty/null — consistent; no finding.
      } else {
        // Normalize both to sorted lowercase for comparison
        const normalizedDeclared = declaredTools.map((t) => t.trim()).sort();
        const normalizedActual = actualTools.map((t) => t.trim()).sort();
        const declaredStr = JSON.stringify(normalizedDeclared);
        const actualStr = JSON.stringify(normalizedActual);

        if (declaredStr !== actualStr) {
          findings.push({
            invariant: 'I0',
            severity: 'HIGH',
            slug,
            description: `GRANT-DRIFT: registry declared_tools does not match .md tools: frontmatter for "${slug}". Registry: [${normalizedDeclared.join(', ')}]. Actual .md: [${normalizedActual.join(', ')}].`,
            declared: normalizedDeclared,
            actual: normalizedActual,
            blast_radius: blastRadius,
            llm06_category: llm06Category,
            timestamp,
            wave,
          });
        }
      }
    }

    // ── I1 — Tier A OVER-PRIVILEGE check ──────────────────────────────
    // Second/Third Line + Write/Edit + no write_scope + scope-contradicting prose
    const hasWriteOrEdit = declaredTools.some((t) => t === 'Write' || t === 'Edit');
    const hasNoWriteScope = writeScope === null || writeScope === undefined;

    if (isSecondOrThirdLine(lineStr) && hasWriteOrEdit && hasNoWriteScope && !isL0Agent) {
      const contradictingPhrase = hasScopeContradictingPhrase(slug);
      if (contradictingPhrase) {
        findings.push({
          invariant: 'I1',
          tier: 'A',
          severity: 'HIGH',
          slug,
          line: lineStr,
          description: `OVER-PRIVILEGE [Tier A]: "${slug}" is ${lineStr} with Write/Edit grant but no declared write_scope, and its description contains scope-contradicting phrase: "${contradictingPhrase}". OWASP LLM06: ${llm06Category}. Resolution: declare a tight write_scope path-glob in the registry entry — do NOT revoke the grant.`,
          blast_radius: blastRadius,
          llm06_category: llm06Category,
          timestamp,
          wave,
        });
      }
    }

    // ── I2 — Tier B UNSCOPED-WRITE check ──────────────────────────────
    // Any Write/Edit agent with write_scope null
    if (hasWriteOrEdit && hasNoWriteScope && !isL0Agent) {
      findings.push({
        invariant: 'I2',
        tier: 'B',
        severity: 'MEDIUM',
        slug,
        line: lineStr,
        description: `UNSCOPED-WRITE [Tier B]: "${slug}" holds Write/Edit but has no declared write_scope (null). Declare a write_scope path-glob to make this grant machine-auditable. This is not a grant revocation request.`,
        blast_radius: blastRadius,
        llm06_category: llm06Category,
        timestamp,
        wave,
      });
    }
  }

  // ── Sort by blast_radius desc ──────────────────────────────────────────
  const sortedFindings = sortByBlastRadius(findings);

  // ── Append each finding to verdicts JSONL ─────────────────────────────
  for (const finding of sortedFindings) {
    appendVerdict(finding);
  }

  // ── Separate by invariant for reporting ───────────────────────────────
  const i0Findings = sortedFindings.filter((f) => f.invariant === 'I0');
  const i1Findings = sortedFindings.filter((f) => f.invariant === 'I1');
  const i2Findings = sortedFindings.filter((f) => f.invariant === 'I2');

  const totalAgents = agents.length;
  const hasViolations = i0Findings.length > 0 || i1Findings.length > 0;

  // ── Print results ──────────────────────────────────────────────────────
  if (i0Findings.length > 0) {
    process.stdout.write(`\n── I0 Grant-Drift Findings (${i0Findings.length}) ──\n`);
    for (const f of i0Findings) {
      process.stdout.write(`  VIOLATION [I0/HIGH] ${f.slug}: ${f.description}\n`);
    }
  }

  if (i1Findings.length > 0) {
    process.stdout.write(`\n── I1 Over-Privilege Findings — Tier A (${i1Findings.length}) ──\n`);
    for (const f of i1Findings) {
      process.stdout.write(`  VIOLATION [I1/HIGH] ${f.slug} (blast_radius: ${f.blast_radius}, llm06: ${f.llm06_category}):\n`);
      process.stdout.write(`    ${f.description}\n`);
    }
  }

  if (i2Findings.length > 0) {
    process.stdout.write(`\n── I2 Unscoped-Write Findings — Tier B (${i2Findings.length}) ──\n`);
    for (const f of i2Findings) {
      process.stdout.write(`  WARN [I2/MEDIUM] ${f.slug} (blast_radius: ${f.blast_radius}):\n`);
      process.stdout.write(`    ${f.description}\n`);
    }
  }

  if (hasViolations) {
    process.stdout.write(
      `\nFAIL — ${totalAgents} agents checked, ${i0Findings.length} I0 grant-drift violation(s), ${i1Findings.length} I1 over-privilege violation(s), ${i2Findings.length} I2 unscoped-write warning(s). Exit 1.\n`
    );
    process.stdout.write(`Verdicts appended to: ${VERDICTS_PATH}\n`);
    process.exit(1);
  }

  if (i2Findings.length > 0) {
    process.stdout.write(
      `\nPASS (with warnings) — ${totalAgents} agents checked, 0 I0 violations, 0 I1 over-privilege violations, ${i2Findings.length} I2 unscoped-write warning(s). Exit 0.\n`
    );
    process.stdout.write(`Warnings appended to: ${VERDICTS_PATH}\n`);
    process.exit(0);
  }

  process.stdout.write(
    `\nPASS — ${totalAgents} agents checked, 0 violations, 0 warnings.\n`
  );
  process.stdout.write(`Verdicts appended to: ${VERDICTS_PATH}\n`);
  process.exit(0);
}

main();
