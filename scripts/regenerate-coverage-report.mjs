#!/usr/bin/env node
/**
 * Part E — Spec Coverage Report generator.
 *
 * Cross-references canonical this project features (14 executor agents, 7 meta-agents,
 * 9 funnels, 5 roles) against all wave-NN_MASTER_SPEC.md files to produce a
 * living gap map at docs/specs/_COVERAGE.md.
 *
 * Source of canonical list:
 *   docs/AGENT_LAYER_ARCHITECTURE.md §0 TL;DR
 *   docs/FUNNEL_REGISTRY.md canonical templates + standard funnels
 *
 * Usage:
 *   node scripts/regenerate-coverage-report.mjs        # write docs/specs/_COVERAGE.md
 *   node scripts/regenerate-coverage-report.mjs --dry  # print summary, do not write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SPECS_DIR = path.join(ROOT, 'docs/specs');
const OUT = path.join(SPECS_DIR, '_COVERAGE.md');
const isDry = process.argv.includes('--dry');

// ── Canonical feature list ─────────────────────────────────────────────
// Source: AGENT_LAYER_ARCHITECTURE.md §0 TL;DR + FUNNEL_REGISTRY.md
const CANONICAL_FEATURES = [
  // 14 Executor Agents (AGENT_LAYER_ARCHITECTURE.md §0)
  { id: 'exec-frontliner', label: 'Frontliner', category: 'executor-agent' },
  { id: 'exec-dispatcher', label: 'Dispatcher Agent', category: 'executor-agent' },
  { id: 'exec-summarizer', label: 'Summarizer', category: 'executor-agent' },
  { id: 'exec-task-manager', label: 'Task Manager', category: 'executor-agent' },
  { id: 'exec-analyst', label: 'Analyst', category: 'executor-agent' },
  { id: 'exec-document', label: 'Document Agent', category: 'executor-agent' },
  { id: 'exec-hr', label: 'HR Agent', category: 'executor-agent' },
  { id: 'exec-reputation-qc', label: 'Reputation & QC Agent', category: 'executor-agent' },
  { id: 'exec-vision', label: 'Vision Estimator', category: 'executor-agent' },
  { id: 'exec-kb-curator', label: 'KB Curator', category: 'executor-agent' },
  { id: 'exec-closer', label: 'Closer', category: 'executor-agent' },
  { id: 'exec-billing', label: 'Billing Agent', category: 'executor-agent' },
  { id: 'exec-maintenance', label: 'Maintenance Steward', category: 'executor-agent' },
  { id: 'exec-growth', label: 'Growth Agent', category: 'executor-agent' },

  // 7 Meta-Agents (AGENT_LAYER_ARCHITECTURE.md §0 + §19)
  { id: 'meta-funnel-designer', label: 'Funnel Designer', category: 'meta-agent' },
  { id: 'meta-stage-composer', label: 'Stage Composer', category: 'meta-agent' },
  { id: 'meta-agent-composer', label: 'Agent Composer', category: 'meta-agent' },
  { id: 'meta-kb-bootstrapper', label: 'KB Bootstrapper', category: 'meta-agent' },
  { id: 'meta-funnel-validator', label: 'Funnel Validator', category: 'meta-agent' },
  { id: 'meta-pipeline-simulator', label: 'Pipeline Simulator', category: 'meta-agent' },
  { id: 'meta-promotion-coach', label: 'Promotion Coach', category: 'meta-agent' },

  // 9 Funnels (FUNNEL_REGISTRY.md — Registry A canonical templates)
  { id: 'funnel-lead-qual', label: 'Lead Qualification', category: 'funnel' },
  { id: 'funnel-installation', label: 'Installation', category: 'funnel' },
  { id: 'funnel-service-repair', label: 'Service/Repair', category: 'funnel' },
  { id: 'funnel-maintenance', label: 'Maintenance Contract', category: 'funnel' },
  { id: 'funnel-hr-onboarding', label: 'HR/Onboarding', category: 'funnel' },
  { id: 'funnel-hr-recruit', label: 'HR Recruiting', category: 'funnel' },
  { id: 'funnel-estimate', label: 'Estimate', category: 'funnel' },
  { id: 'funnel-quality-control', label: 'Quality Control', category: 'funnel' },
  { id: 'funnel-reputation', label: 'Reputation', category: 'funnel' },

  // 5 Roles (ROLE_PERMISSION_MATRIX.md + AGENT_LAYER_ARCHITECTURE.md §1)
  { id: 'role-owner', label: 'Owner', category: 'role' },
  { id: 'role-dispatcher', label: 'Dispatcher', category: 'role' },
  { id: 'role-tech', label: 'Tech', category: 'role' },
  { id: 'role-lead-tech', label: 'Lead-tech', category: 'role' },
  { id: 'role-office', label: 'Office', category: 'role' },
];

const CATEGORY_LABELS = {
  'executor-agent': 'Executor Agents',
  'meta-agent': 'Meta-Agents',
  'funnel': 'Funnels',
  'role': 'Roles',
};

// ── Load all spec files ────────────────────────────────────────────────
function loadSpecContents(specsDir) {
  if (!fs.existsSync(specsDir)) return [];
  const files = fs
    .readdirSync(specsDir)
    .filter((f) => /^wave-[\d]/.test(f) && f.endsWith('_MASTER_SPEC.md'));

  return files.map((file) => {
    const filePath = path.join(specsDir, file);
    const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
    const specId = file.match(/^wave-([\d]+(?:\.[\d]+[a-z]?)?)/)?.[0] ?? file;
    return { specId, content };
  });
}

// ── Coverage check: search spec content for feature label ─────────────
// Case-insensitive substring match. Also tries common aliases.
const ALIASES = {
  'Dispatcher Agent': ['dispatcher agent', 'dispatcher-agent', 'the dispatcher'],
  'HR Agent': ['hr agent', 'hr-agent', 'the recruiter'],
  'KB Curator': ['kb curator', 'kb-curator', 'knowledge base curator'],
  'Reputation & QC Agent': ['reputation & qc', 'reputation and qc', 'qc agent', 'reputation agent'],
  'Maintenance Steward': ['maintenance steward', 'the steward', 'maintenance agent'],
  'Growth Agent': ['growth agent', 'the growth'],
  'Vision Estimator': ['vision estimator', 'vision-estimator', 'estimate vision'],
  'Funnel Designer': ['funnel designer', 'funnel-designer'],
  'Stage Composer': ['stage composer', 'stage-composer'],
  'Agent Composer': ['agent composer', 'agent-composer'],
  'KB Bootstrapper': ['kb bootstrapper', 'kb-bootstrapper'],
  'Funnel Validator': ['funnel validator', 'funnel-validator'],
  'Pipeline Simulator': ['pipeline simulator', 'pipeline-simulator'],
  'Promotion Coach': ['promotion coach', 'promotion-coach'],
  'HR/Onboarding': ['hr/onboarding', 'hr onboarding', 'hr-onboarding'],
  'HR Recruiting': ['hr recruit', 'hr-recruit', 'recruiting funnel'],
  'Service/Repair': ['service/repair', 'service repair', 'service-repair'],
  'Maintenance Contract': ['maintenance contract', 'maintenance-contract'],
  'Quality Control': ['quality control', 'quality-control'],
  'Lead Qualification': ['lead qualification', 'lead-qualification'],
};

function findCoverage(feature, specs) {
  const searches = [feature.label.toLowerCase()];
  if (ALIASES[feature.label]) {
    searches.push(...ALIASES[feature.label]);
  }

  for (const { specId, content } of specs) {
    if (searches.some((s) => content.includes(s))) {
      return specId;
    }
  }
  return null;
}

// ── Build coverage results ─────────────────────────────────────────────
function buildCoverage(specs) {
  return CANONICAL_FEATURES.map((feature) => {
    const coveredBy = findCoverage(feature, specs);
    return { ...feature, coveredBy };
  });
}

// ── Format markdown output ─────────────────────────────────────────────
function buildMarkdown(results, timestamp) {
  const total = results.length;
  const covered = results.filter((r) => r.coveredBy !== null).length;
  const pct = Math.round((covered / total) * 100);

  const lines = [];
  lines.push('# Spec Coverage Report');
  lines.push('');
  lines.push(`> Auto-generated by \`scripts/regenerate-coverage-report.mjs\` — do not edit manually. Last update: ${timestamp}`);
  lines.push('');
  lines.push(`## Coverage summary — ${covered} / ${total} canonical features have specs (${pct}%)`);
  lines.push('');
  lines.push('| Feature | Category | Status | Covered by |');
  lines.push('|---|---|---|---|');

  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }

  // Output in canonical order
  for (const cat of ['executor-agent', 'meta-agent', 'funnel', 'role']) {
    const catResults = byCategory[cat] ?? [];
    if (catResults.length === 0) continue;
    // Category header row (span trick not supported in GFM, use bold label)
    lines.push(`| **${CATEGORY_LABELS[cat]}** | | | |`);
    for (const r of catResults) {
      const status = r.coveredBy ? 'COVERED' : 'MISSING';
      const coveredCell = r.coveredBy ? r.coveredBy : '-';
      lines.push(`| ${r.label} | ${r.category} | ${status} | ${coveredCell} |`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- COVERED means at least one wave-NN_MASTER_SPEC.md mentions the feature by name or alias.');
  lines.push('- MISSING means no spec file references this feature — it may be planned, coming-soon, or genuinely unspecced.');
  lines.push('- Coverage check is keyword-based (case-insensitive substring). A feature mentioned in §2 Context counts as covered.');
  lines.push('- Run `node scripts/regenerate-coverage-report.mjs` to refresh after adding new specs.');
  lines.push('');

  return lines.join('\n');
}

// ── Per-level coverage (wave-117 Part E) ──────────────────────────────
// YAML + bold-field two-pass parser for level field extraction.
function extractYamlBlockForCoverage(content) {
  const m = content.match(/^---\n([\s\S]+?)\n---/m);
  return m ? m[1] : null;
}

function extractYamlFieldForCoverage(yamlBlock, fieldName) {
  if (!yamlBlock) return null;
  const re = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const m = yamlBlock.match(re);
  return m ? m[1].trim() : null;
}

function extractYamlParentsForCoverage(yamlBlock) {
  if (!yamlBlock) return [];
  const parentsMatch = yamlBlock.match(/^parents:\n((?:[ \t]+.*\n?)+)/m);
  if (!parentsMatch) return [];
  const block = parentsMatch[1];
  const items = block.split(/^[\s\t]+-\s+path:/m).slice(1);
  const entries = [];
  for (const item of items) {
    const pathVal = item.split('\n')[0].trim();
    entries.push({ path: pathVal });
  }
  return entries;
}

function extractLevelForCoverage(content) {
  const yamlBlock = extractYamlBlockForCoverage(content);
  const fromYaml = extractYamlFieldForCoverage(yamlBlock, 'level');
  if (fromYaml) return fromYaml;
  const lines = content.split('\n').slice(0, 20).join('\n');
  const m = lines.match(/^\*\*level\*\*:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

// Walk docs/ recursively and collect all .md files (skipping _-prefixed).
function collectAllDocSpecFiles() {
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
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (entry.name.startsWith('_')) continue;
        results.push(fullPath);
      }
    }
  }

  walk(DOCS_DIR);
  return results;
}

// Expected counts per level (updated post wave-118 backfill).
// L0: 3 — docs/MISSION.md + PRODUCT_PHILOSOPHY.md + CONSTITUTION.md
// L1: 9 — AGENT_LAYER_ARCHITECTURE, AGENT_LAYER_QUALITY_SPEC, FUNNEL_REGISTRY,
//         ROLE_PERMISSION_MATRIX, VOICE_GUIDE, PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER,
//         MULTI_LEVEL_VERIFICATION, MODULE_SPEC_SYSTEM, HIERARCHICAL_SPEC_SYSTEM
// L2: 0 initially (no domain specs yet — wave-119 introduces 7-9)
// L3: counted from docs/specs/modules/**/*.md (reuses countModuleSpecs below)
// L4: counted as wave-NN_MASTER_SPEC.md files
const LEVEL_EXPECTED = {
  L0: 3,
  L1: 9,
  L2: 7,  // 7 bounded contexts shipped wave-119
  L3: null, // computed dynamically from module specs
  L4: null, // computed dynamically from wave spec count
};

function buildPerLevelCoverage(l4WaveSpecCount, l3ModuleSpecCount) {
  const allFiles = collectAllDocSpecFiles();

  const levelCounts = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  const orphansByLevel = { L2: [], L3: [] };

  for (const filePath of allFiles) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const level = extractLevelForCoverage(content);
    if (!level || !Object.prototype.hasOwnProperty.call(levelCounts, level)) continue;

    levelCounts[level]++;

    // Orphan check for L2 and L3: must have parents[].path declared
    if (level === 'L2' || level === 'L3') {
      const yamlBlock = extractYamlBlockForCoverage(content);
      const parents = extractYamlParentsForCoverage(yamlBlock);
      if (parents.length === 0) {
        const relPath = path.relative(ROOT, filePath);
        orphansByLevel[level].push(relPath);
      }
    }
  }

  // Use dynamic counts for L3 (module specs) and L4 (wave specs)
  const effective = {
    L0: { found: levelCounts.L0, expected: LEVEL_EXPECTED.L0 },
    L1: { found: levelCounts.L1, expected: LEVEL_EXPECTED.L1 },
    L2: { found: levelCounts.L2, expected: LEVEL_EXPECTED.L2 },
    L3: { found: l3ModuleSpecCount, expected: l3ModuleSpecCount }, // denominator = found for now
    L4: { found: levelCounts.L4, expected: l4WaveSpecCount },
  };

  return { effective, orphansByLevel };
}

function formatPerLevelSection(effective, orphansByLevel) {
  const lines = [];
  lines.push('## Per-level coverage');
  lines.push('');

  const LEVEL_NAMES = {
    L0: 'Constitution',
    L1: 'Core Architecture',
    L2: 'Domains',
    L3: 'Modules',
    L4: 'Waves',
  };

  // Summary lines (L0: N/N (X%) format) for quick grep / verification
  for (const level of ['L0', 'L1', 'L2', 'L3', 'L4']) {
    const { found, expected } = effective[level];
    let pct;
    if (expected === 0 || expected === null) {
      pct = 'N/A';
    } else {
      pct = `${Math.round((found / expected) * 100)}%`;
    }
    lines.push(`${level}: ${found}/${expected ?? '?'} (${pct})`);
  }

  lines.push('');
  lines.push('| Level | Name | Found | Expected | Coverage | Notes |');
  lines.push('|---|---|---|---|---|---|');

  for (const level of ['L0', 'L1', 'L2', 'L3', 'L4']) {
    const { found, expected } = effective[level];
    let pct;
    let notes = '';

    if (expected === 0 || expected === null) {
      pct = 'N/A';
    } else {
      pct = `${Math.round((found / expected) * 100)}%`;
    }

    const orphans = orphansByLevel[level] ?? [];
    if (orphans.length > 0) {
      notes = `ORPHAN: ${orphans.join(', ')}`;
    }

    lines.push(`| ${level} | ${LEVEL_NAMES[level]} | ${found} | ${expected ?? 'dynamic'} | ${pct} | ${notes} |`);
  }

  lines.push('');
  lines.push('> Level field is populated from YAML frontmatter `level:` or bold-field `**level**:` fallback.');
  lines.push('> L2/L3 specs without a `parents[].path` declaration are flagged ORPHAN.');
  lines.push('');

  return lines.join('\n');
}

// ── L3 module coverage ─────────────────────────────────────────────────
// Wave-108: count module spec files in docs/specs/modules/**/*.md.
// Counted: real spec files including _EXAMPLE.md seeds.
// NOT counted: _MODULE_TEMPLATE.md, README.md, _MODULE_INDEX.md.
// Denominator hardcoded: 49 = 24 agents (14 exec + 7 meta + 3 sub)
//   + 9 funnels + 10 surfaces (tracked subset) + 6 infra.
// If category counts change during backfill (wave-110–114), update denominator
// and document in a comment here.
const L3_DENOMINATOR = 49;

function countModuleSpecs() {
  const MODULES_DIR = path.join(ROOT, 'docs/specs/modules');
  if (!fs.existsSync(MODULES_DIR)) return 0;

  let count = 0;

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
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Exclude non-spec files
        if (entry.name === '_MODULE_TEMPLATE.md') continue;
        if (entry.name === '_MODULE_INDEX.md') continue;
        if (entry.name === 'README.md') continue;
        // _EXAMPLE.md files ARE counted (they are real module specs)
        count++;
      }
    }
  }

  walk(MODULES_DIR);
  return count;
}

function buildL3StatLine(covered, denominator) {
  const pct = Math.round((covered / denominator) * 100);
  return `L3 modules: ${covered} / ${denominator} covered (${pct}%)`;
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  const specs = loadSpecContents(SPECS_DIR);
  const results = buildCoverage(specs);

  const total = results.length;
  const covered = results.filter((r) => r.coveredBy !== null).length;
  const pct = Math.round((covered / total) * 100);
  const summary = `Coverage: ${covered} / ${total} canonical features have specs (${pct}%)`;

  // L3 module coverage (wave-108)
  const l3Covered = countModuleSpecs();
  const l3StatLine = buildL3StatLine(l3Covered, L3_DENOMINATOR);

  // Count L4 wave specs for per-level denominator
  const l4WaveSpecCount = specs.length;

  // Per-level coverage (wave-117 Part E)
  const { effective: levelEffective, orphansByLevel } = buildPerLevelCoverage(l4WaveSpecCount, l3Covered);
  const perLevelSection = formatPerLevelSection(levelEffective, orphansByLevel);

  if (isDry) {
    console.log(`[dry] ${summary}`);
    const missing = results.filter((r) => !r.coveredBy).map((r) => r.label);
    console.log(`[dry] MISSING (${missing.length}): ${missing.join(', ')}`);
    console.log(`[dry] ${l3StatLine}`);
    console.log('[dry] Per-level coverage:');
    console.log(perLevelSection);
    return;
  }

  const timestamp = new Date().toISOString();
  let output = buildMarkdown(results, timestamp);

  // Append L3 module coverage section
  output += `## L3 Module Coverage\n\n`;
  output += `> Auto-counted from \`docs/specs/modules/**/*.md\`. Excludes _MODULE_TEMPLATE.md, README.md, _MODULE_INDEX.md.\n`;
  output += `> Denominator: 49 = 24 agents (14 exec + 7 meta + 3 sub) + 9 funnels + 10 surfaces + 6 infra.\n`;
  output += `> Backfill: wave-110 (agents), wave-111 (infra), wave-112 (funnels), wave-113–114 (surfaces).\n\n`;
  output += `${l3StatLine}\n\n`;

  // Append per-level section (wave-117 Part E)
  output += perLevelSection;

  fs.writeFileSync(OUT, output);
  console.log(`[coverage] ${summary}`);
  console.log(`[coverage] ${l3StatLine}`);
  console.log(`[coverage] wrote docs/specs/_COVERAGE.md`);
}

main();
