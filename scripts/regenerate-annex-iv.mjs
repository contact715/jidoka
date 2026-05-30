#!/usr/bin/env node
/**
 * regenerate-annex-iv.mjs — Wave-162 killer differentiator.
 *
 * Reads ARC42 §10 (Quality Requirements) and §11 (Risks / Technical Decisions)
 * sections from docs/specs/wave-*_MASTER_SPEC.md files and populates a 9-section
 * EU AI Act Annex IV technical documentation skeleton.
 *
 * Mirrors scripts/regenerate-specs-index.mjs:1-50 glob + frontmatter loop pattern.
 *
 * Usage:
 *   node scripts/regenerate-annex-iv.mjs         # write docs/compliance/eu-ai-act/annex-iv-auto.md
 *   node scripts/regenerate-annex-iv.mjs --dry   # print to stdout, do not write
 *
 * Annex IV section mapping:
 *   Section 1  — General description (ARC42 §1 Vision)
 *   Section 2  — Intended purpose, supply chain (ARC42 §2 Context / frontmatter parents)
 *   Section 3  — Training data, evaluation, testing (ARC42 §4 / §10 Quality)
 *   Section 4  — Performance metrics — [NEEDS HUMAN INPUT]
 *   Section 5  — System architecture (ARC42 §3 / §5)
 *   Section 6  — Human oversight (ARC42 §6 + Art 14 cross-ref)
 *   Section 7  — Post-market monitoring (ARC42 §11 Risks)
 *   Section 8  — EU Declaration of Conformity — [NEEDS HUMAN INPUT]
 *   Section 9  — Post-market monitoring plan — [NEEDS HUMAN INPUT]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SPECS_DIR = path.join(ROOT, 'docs', 'specs');
const OUT = path.join(ROOT, 'docs', 'compliance', 'eu-ai-act', 'annex-iv-auto.md');
const isDry = process.argv.includes('--dry');

// ── Frontmatter helpers (mirrors regenerate-specs-index.mjs) ──────────────
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

function extractLevel(content) {
  const yamlBlock = extractYamlBlock(content);
  const fromYaml = extractYamlField(yamlBlock, 'level');
  if (fromYaml) return fromYaml;
  const fmSlice = content.split('\n').slice(0, 20).join('\n');
  const m = fmSlice.match(/^\*\*level\*\*:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractTitle(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

// ── ARC42 section extractor ────────────────────────────────────────────────
/**
 * Extract the content of a markdown section by heading number or keyword.
 * Returns the body text (without the heading line) up to the next ## heading.
 * Returns null if the section is not found.
 */
function extractSection(content, sectionPattern) {
  // Match ## <number>. <title> or ## <keyword>
  const re = new RegExp(`^##\\s+${sectionPattern}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$)`, 'mi');
  const m = content.match(re);
  if (!m) return null;
  const body = m[1].trim();
  return body.length > 0 ? body : null;
}

// ── Glob wave specs ────────────────────────────────────────────────────────
function globWaveSpecs() {
  if (!fs.existsSync(SPECS_DIR)) return [];
  return fs
    .readdirSync(SPECS_DIR)
    .filter(f => /^wave-\d+.*_MASTER_SPEC\.md$/.test(f))
    .sort((a, b) => {
      const aNum = (a.match(/^wave-(\d+)/) || [])[1];
      const bNum = (b.match(/^wave-(\d+)/) || [])[1];
      return Number(aNum || 0) - Number(bNum || 0);
    })
    .map(f => path.join(SPECS_DIR, f));
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
  const allSpecs = globWaveSpecs();

  if (allSpecs.length === 0) {
    process.stderr.write('[annex-iv] No wave master spec files found in docs/specs/\n');
    process.exit(0);
  }

  // Filter L1-level specs first; fall back to all specs if none found
  let targetSpecs = allSpecs.filter(f => {
    const content = fs.readFileSync(f, 'utf8');
    return extractLevel(content) === 'L1';
  });

  const usingFallback = targetSpecs.length === 0;
  if (usingFallback) {
    process.stderr.write(
      '[annex-iv] No L1 spec found — using L4 specs as fallback. ' +
      'Populate with L1 system-level specs for higher-quality Annex IV content.\n'
    );
    targetSpecs = allSpecs;
  }

  // Collect ARC42 content from all target specs
  const specSummaries = [];
  const visionBits = [];
  const contextBits = [];
  const qualityBits = [];
  const architectureBits = [];
  const riskBits = [];

  for (const specPath of targetSpecs) {
    const content = fs.readFileSync(specPath, 'utf8');
    const filename = path.basename(specPath);
    const title = extractTitle(content) ?? filename;
    const level = extractLevel(content) ?? '?';

    specSummaries.push(`- ${filename} (${level}): ${title}`);

    // ARC42 §1 — Vision / Introduction
    const vision = extractSection(content, '1[.\\.]') ??
                   extractSection(content, 'Vision') ??
                   extractSection(content, 'Introduction');
    if (vision) visionBits.push(`### From ${filename}\n\n${vision.slice(0, 500)}${vision.length > 500 ? '\n\n...(truncated)' : ''}`);

    // ARC42 §2 — Context / Stakeholders / Quad-Lens Synthesis
    const context = extractSection(content, '2[.\\.]') ??
                    extractSection(content, 'Current state') ??
                    extractSection(content, 'Quad-Lens');
    if (context) contextBits.push(`### From ${filename}\n\n${context.slice(0, 400)}${context.length > 400 ? '\n\n...(truncated)' : ''}`);

    // ARC42 §10 — Quality Requirements (maps to Annex IV §3)
    const quality = extractSection(content, '10[.\\.]') ??
                    extractSection(content, 'Quality requirements');
    if (quality) qualityBits.push(`### From ${filename}\n\n${quality.slice(0, 600)}${quality.length > 600 ? '\n\n...(truncated)' : ''}`);

    // ARC42 §3 — Architecture / Solution Strategy (maps to Annex IV §5)
    const architecture = extractSection(content, '3[.\\.]') ??
                         extractSection(content, 'Architecture');
    if (architecture) architectureBits.push(`### From ${filename}\n\n${architecture.slice(0, 500)}${architecture.length > 500 ? '\n\n...(truncated)' : ''}`);

    // ARC42 §11 — Risks / Technical Decisions (maps to Annex IV §7)
    const risks = extractSection(content, '11[.\\.]') ??
                  extractSection(content, 'Risks');
    if (risks) riskBits.push(`### From ${filename}\n\n${risks.slice(0, 600)}${risks.length > 600 ? '\n\n...(truncated)' : ''}`);
  }

  const now = new Date().toISOString();
  const specsReadLine = usingFallback
    ? `${targetSpecs.length} L4 specs (L1 fallback)`
    : `${targetSpecs.length} L1 specs`;

  // ── Build output document ────────────────────────────────────────────────
  const output = `---
doc_type: compliance-generated
article: EU AI Act Annex IV — Technical Documentation
generated_by: scripts/regenerate-annex-iv.mjs
regenerated: ${now}
specs_read: ${specsReadLine}
status: AUTO-GENERATED SKELETON — human review required before regulatory use
---

# Annex IV — Technical Documentation (Auto-Generated)

> **How this file is generated**: \`node scripts/regenerate-annex-iv.mjs\` reads ARC42 §10/§11
> content from \`docs/specs/wave-*_MASTER_SPEC.md\` and populates sections 1-3 and 5-7.
> Sections 4, 8, and 9 always carry \`[NEEDS HUMAN INPUT]\` markers.
>
> **Not a compliance submission**: This is a starting point to reduce a 40-hour compliance project
> to a 4-hour human review. A qualified person must complete and sign off before regulatory use.
>
> Run \`npm run annex-iv:regen\` to refresh from latest wave specs.

---

## Specs read (${specsReadLine})

${specSummaries.join('\n')}

---

## Annex IV Section 1 — General Description of the AI System

> Populated from ARC42 §1 (Vision) across ${visionBits.length} spec(s).

${visionBits.length > 0 ? visionBits.join('\n\n---\n\n') : '_No ARC42 §1 Vision sections found in target specs. Add a "## 1. Vision" or "## Vision" section to wave master specs._'}

---

## Annex IV Section 2 — Intended Purpose, Persons Responsible, Supply Chain

> Populated from ARC42 §2 (Current state / Context) across ${contextBits.length} spec(s).

${contextBits.length > 0 ? contextBits.join('\n\n---\n\n') : '_No ARC42 §2 context sections found. Add a "## 2. Current state" section to wave master specs._'}

**Intended users**: Home services companies and auto shops deploying this project as a B2B SaaS.
**Provider**: this project (see \`docs/MISSION.md\` for company details).
**Supply chain**: OpenAI (LLM/voice), Twilio (telephony), Stripe (billing) — see \`docs/compliance/eu-ai-act/art-13-transparency.md §6\`.

---

## Annex IV Section 3 — Training Data, Evaluation, and Testing

> Populated from ARC42 §10 (Quality requirements) across ${qualityBits.length} spec(s).

${qualityBits.length > 0 ? qualityBits.join('\n\n---\n\n') : '_No ARC42 §10 quality requirement sections found. Add "## 10. Quality requirements" to wave master specs._'}

**Data note**: this project does not train custom models. All LLM inference is via BYOK passthrough to
OpenAI. Base model training data governance is OpenAI's responsibility. If custom fine-tuning
ships in a future wave, Art 10 data governance documentation is required (deferred — see
\`docs/compliance/eu-ai-act/hrais-classification.md\`).

---

## Annex IV Section 4 — Performance Metrics and Thresholds

[NEEDS HUMAN INPUT]

Performance metric justification requires human decision-making. Provide:
- Key performance indicators (accuracy, recall, false positive rate as applicable to the HR funnel).
- Threshold values and the rationale for each.
- Acceptable performance ranges per deployment context (home services vs auto shop).
- Testing conditions under which metrics were measured.

Partial scaffolding from \`docs/quality/perf-budget.json\`:
- Bundle size: global warn threshold +10%, fail threshold +25%
- LCP targets: landing-auth 2.0s, dashboard-lead-list 2.5s, conversation-chat 2.0s

---

## Annex IV Section 5 — System Architecture and Technical Description

> Populated from ARC42 §3 (Architecture) across ${architectureBits.length} spec(s).

${architectureBits.length > 0 ? architectureBits.join('\n\n---\n\n') : '_No ARC42 §3 architecture sections found. Add "## 3. Architecture" to wave master specs._'}

**Stack reference**: Next.js 14 (frontend) + FastAPI/PostgreSQL (backend) + OpenAI Realtime API (voice) + Twilio (telephony). See \`ARCHITECTURE.md\` for full architecture diagram.

---

## Annex IV Section 6 — Human Oversight Measures

> Cross-reference: Art 14 compliance artifacts (wave-154, \`docs/audits/cross-line-verdicts.jsonl\`).
> See also: \`docs/runbooks/incident-response.md\` for IC/OL/CL escalation paths.

**Human oversight mechanisms (wave-154 + wave-162)**:
- Cross-line dispatch checker: prevents AI agents from taking actions outside their sanctioned scope.
- PFCA gate: human-in-approval-seat for all wave implementations (wave-159+).
- Incident Commander role: human IC owns all P1/P2 incident decisions.
- Audit log: all AI gate evaluations logged to \`docs/audits/checklist-runs.jsonl\` (append-only).

---

## Annex IV Section 7 — Measures for Post-Market Monitoring

> Populated from ARC42 §11 (Risks) across ${riskBits.length} spec(s).

${riskBits.length > 0 ? riskBits.join('\n\n---\n\n') : '_No ARC42 §11 risk sections found. Add "## 11. Risks" to wave master specs._'}

**Monitoring infrastructure**:
- Incident response: \`docs/runbooks/incident-response.md\`
- Change management: \`docs/runbooks/change-management.md\`
- Rollback protocol: \`docs/runbooks/rollback-protocol.md\`
- Audit backlog dashboard: \`npm run audit:backlog\`

---

## Annex IV Section 8 — EU Declaration of Conformity

[NEEDS HUMAN INPUT]

Must be signed by the natural or legal person responsible for placing the AI system on the market.
Required content:
- Provider name and registered address.
- System name and version.
- EU AI Act provisions complied with (Articles and Annexes).
- Reference to harmonised standards or technical specifications applied (if any).
- Place and date of issue.
- Signature of the responsible natural person.

Template: EU AI Act Annex V (Declaration of Conformity format, Regulation (EU) 2024/1689).

---

## Annex IV Section 9 — Post-Market Monitoring Plan

[NEEDS HUMAN INPUT]

Requires human judgment on:
- Monitoring frequency and responsible party.
- KPIs to track after deployment (per §4 — to be completed).
- Reporting obligations to the national supervisory authority (if HRAIS confirmed for HR funnel).
- Conditions triggering re-assessment of HRAIS classification.
- Process for incorporating user feedback.

Scaffolding:
- Incident process: \`docs/runbooks/incident-response.md\`
- Change process: \`docs/runbooks/change-management.md\`
- Audit log: \`docs/audits/checklist-runs.jsonl\`
- HRAIS re-assessment trigger: see \`docs/compliance/eu-ai-act/hrais-classification.md §4\`

---

## Regeneration Log

| Date | Triggered by | Specs read |
|---|---|---|
| ${now} | \`node scripts/regenerate-annex-iv.mjs\` | ${specsReadLine} |
`;

  if (isDry) {
    process.stdout.write(output);
    process.exit(0);
  }

  // Ensure output directory exists
  const outDir = path.dirname(OUT);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(OUT, output, 'utf8');
  process.stdout.write(
    `[annex-iv] wrote ${specSummaries.length} spec(s) → docs/compliance/eu-ai-act/annex-iv-auto.md\n` +
    `[annex-iv] Sections 4, 8, 9 carry [NEEDS HUMAN INPUT] markers.\n`
  );
}

main();
