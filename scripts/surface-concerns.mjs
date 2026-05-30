#!/usr/bin/env node
// @ts-check
/**
 * Wave-155 — Proactive Surfacing Agent script
 *
 * Reads retros, anti-pattern catalog, memory snapshot, and escalated proposals.
 * Produces a prioritized concern queue at docs/surfacing-concerns-current.md.
 *
 * Usage:
 *   node scripts/surface-concerns.mjs           # full run, writes output file
 *   node scripts/surface-concerns.mjs --dry     # stdout only, no file writes
 *   node scripts/surface-concerns.mjs --respond "<title>" <type> [reason]
 *
 * Response types: addressed | deferred | declined | disputed
 *
 * Exit codes:
 *   0 — success (including zero concerns found)
 *   1 — invalid arguments or write failure
 *
 * MCP fallback: docs/memory-anti-patterns.md is the git-tracked snapshot.
 * If the MCP is unavailable, the script reads the snapshot and continues.
 * Dependency on docs/CURRENT_WAVE.md: if the file is missing or unparseable,
 * E3 escalation logic is skipped with a stderr warning.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const RETROS_DIR = path.join(ROOT, 'docs/retros');
const CATALOG_PATH = path.join(ROOT, 'docs/ANTI_PATTERNS_CATALOG.md');
const MEMORY_SNAPSHOT_PATH = path.join(ROOT, 'docs/memory-anti-patterns.md');
const CURRENT_WAVE_PATH = path.join(ROOT, 'docs/CURRENT_WAVE.md');
const OUTPUT_PATH = path.join(ROOT, 'docs/surfacing-concerns-current.md');
const LOG_PATH = path.join(ROOT, 'docs/audit-reports/surfaced-concerns-log.md');
const PROTOCOL_PATH = path.join(ROOT, 'docs/PROACTIVE_SURFACING_PROTOCOL.md');

const LOG_HEADER = '| timestamp | concern-title | response-type | user-reasoning | wave-at-response |\n|---|---|---|---|---|\n';

// ---------------------------------------------------------------------------
// Types (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {'BLOCKING' | 'IMPORTANT' | 'NICE'} Severity
 *
 * @typedef {{
 *   title: string,
 *   severity: Severity,
 *   observed_in: string,
 *   industry_misalignment: string,
 *   reason_not_surfaced: string,
 *   proposed_wave: string,
 *   cost_of_silence: string,
 *   status: 'open' | 'addressed' | 'deferred' | 'declined' | 'disputed'
 * }} Concern
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {string} msg */
function warn(msg) {
  process.stderr.write(`[surface-concerns] WARN: ${msg}\n`);
}

/** @param {string} msg */
function info(msg) {
  process.stdout.write(`[surface-concerns] ${msg}\n`);
}

/**
 * Read a file safely, returning empty string on missing.
 * @param {string} filePath
 * @returns {string}
 */
function readSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Get the last N retro files sorted by modification time (most recent first).
 * @param {number} n
 * @returns {string[]} file paths
 */
function getLastNRetros(n) {
  if (!fs.existsSync(RETROS_DIR)) {
    warn(`retros directory not found: ${RETROS_DIR}`);
    return [];
  }
  /** @type {Array<{path: string, mtime: number}>} */
  const files = [];
  for (const name of fs.readdirSync(RETROS_DIR)) {
    if (!name.startsWith('wave-') || !name.endsWith('.md')) continue;
    const filePath = path.join(RETROS_DIR, name);
    try {
      const stat = fs.statSync(filePath);
      files.push({ path: filePath, mtime: stat.mtimeMs });
    } catch {
      // skip unreadable
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, n).map((f) => f.path);
}

/**
 * Extract "Out-of-scope follow-ups" section content from a retro file.
 * Returns the raw text after the heading until the next ## heading or EOF.
 * @param {string} content
 * @returns {string}
 */
function extractOutOfScopeSection(content) {
  const match = content.match(/##\s*Out-of-scope follow-ups([\s\S]*?)(?=^##|\z)/m);
  return match ? match[1].trim() : '';
}

/**
 * Extract anti-pattern slugs from the catalog.
 * Lines like "### N. slug-name"
 * @returns {string[]}
 */
function extractCatalogSlugs() {
  const content = readSafe(CATALOG_PATH);
  if (!content) {
    warn('ANTI_PATTERNS_CATALOG.md not found — using hardcoded slug list');
    return [
      'reactive-incremental-thinking',
      'partial-closure-via-documentation',
      'optimistic-completion-bias',
      'asymmetric-closure-standards',
      'over-documentation',
      'scope-creep-mid-wave',
      'wave-spec-drift',
    ];
  }
  /** @type {string[]} */
  const slugs = [];
  for (const m of content.matchAll(/^###\s+\d+\.\s+([\w-]+)/gm)) {
    slugs.push(m[1]);
  }
  return slugs;
}

/**
 * Extract the current wave number from docs/CURRENT_WAVE.md.
 * Returns null if missing or unparseable.
 * @returns {number | null}
 */
function extractCurrentWave() {
  const content = readSafe(CURRENT_WAVE_PATH);
  if (!content) {
    warn('docs/CURRENT_WAVE.md not found — E3 escalation skipped');
    return null;
  }
  const match = content.match(/Latest wave.*?wave-(\d+)/);
  if (!match) {
    warn('Could not parse wave number from docs/CURRENT_WAVE.md — E3 escalation skipped');
    return null;
  }
  return parseInt(match[1], 10);
}

/**
 * Read the anti-suppression log and return a Set of concern titles that have responses.
 * @returns {Set<string>}
 */
function getAddressedTitles() {
  const content = readSafe(LOG_PATH);
  const addressed = new Set();
  if (!content) return addressed;
  for (const line of content.split('\n')) {
    // Table rows: | timestamp | concern-title | response-type | ...
    const match = line.match(/^\|\s*[^|]+\|\s*([^|]+)\|\s*(addressed|deferred|declined|disputed)/i);
    if (match) {
      addressed.add(match[1].trim());
    }
  }
  return addressed;
}

/**
 * Read the previous concerns from docs/surfacing-concerns-current.md and extract
 * {title, severity, wave_origin} so E3 escalation can compare.
 * @returns {Array<{title: string, severity: Severity, wave_origin: number}>}
 */
function getPreviousConcerns() {
  const content = readSafe(OUTPUT_PATH);
  if (!content) return [];
  /** @type {Array<{title: string, severity: Severity, wave_origin: number}>} */
  const result = [];
  let currentTitle = '';
  let currentSeverity = /** @type {Severity} */ ('NICE');
  for (const line of content.split('\n')) {
    const titleMatch = line.match(/^##\s+(.+)/);
    if (titleMatch) {
      currentTitle = titleMatch[1].trim();
      currentSeverity = 'NICE';
    }
    const sevMatch = line.match(/- severity:\s*(BLOCKING|IMPORTANT|NICE)/);
    if (sevMatch) currentSeverity = /** @type {Severity} */ (sevMatch[1]);
    const obsMatch = line.match(/- observed_in:\s*wave-(\d+)/);
    if (obsMatch && currentTitle) {
      result.push({
        title: currentTitle,
        severity: currentSeverity,
        wave_origin: parseInt(obsMatch[1], 10),
      });
    }
  }
  return result;
}

/**
 * Escalate severity one level.
 * @param {Severity} s
 * @returns {Severity}
 */
function escalate(s) {
  if (s === 'NICE') return 'IMPORTANT';
  if (s === 'IMPORTANT') return 'BLOCKING';
  return 'BLOCKING';
}

/**
 * Check the industry checklist in PROACTIVE_SURFACING_PROTOCOL.md for ❌ items.
 * Returns concern entries for each unchecked pattern.
 * @param {number} currentWave
 * @param {Set<string>} addressed
 * @returns {Concern[]}
 */
function checkIndustryChecklist(currentWave, addressed) {
  const content = readSafe(PROTOCOL_PATH);
  if (!content) return [];
  /** @type {Concern[]} */
  const concerns = [];
  // Find rows with ❌ in the industry table — format: | **Pattern** | Source | ❌ ...
  for (const m of content.matchAll(/\|\s*\*\*([^*]+)\*\*[^|]*\|[^|]*\|[^|]*❌([^|]*)\|/g)) {
    const patternName = m[1].trim();
    const detail = m[2].trim();
    const title = `industry-checklist: ${patternName} not fully implemented`;
    if (addressed.has(title)) continue;
    concerns.push({
      title,
      severity: 'NICE',
      observed_in: `docs/PROACTIVE_SURFACING_PROTOCOL.md (industry checklist)`,
      industry_misalignment: `${patternName}: ${detail || 'not implemented'}`,
      reason_not_surfaced: 'Industry checklist was not part of the dev system before wave-155',
      proposed_wave: 'TBD',
      cost_of_silence: `Without ${patternName}, the system misses the risk detection class it provides`,
      status: 'open',
    });
  }
  return concerns;
}

// ---------------------------------------------------------------------------
// Signal engines
// ---------------------------------------------------------------------------

/**
 * Retro scanner — anti-pattern slug recurrence across last 10 retros.
 * @param {string[]} retroPaths
 * @param {string[]} slugs
 * @param {Set<string>} addressed
 * @param {number | null} currentWave
 * @returns {Concern[]}
 */
function scanRetrosForAntiPatterns(retroPaths, slugs, addressed, currentWave) {
  /** @type {Concern[]} */
  const concerns = [];

  for (const slug of slugs) {
    /** @type {string[]} */
    const retrosWithHit = [];

    for (const retroPath of retroPaths) {
      const content = readSafe(retroPath);
      if (!content) continue;
      // Case-insensitive match for slug, not preceded by "shipped"/"addressed"/"closed" on the same line
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.toLowerCase().includes(slug.toLowerCase())) {
          // Check if the line itself (or the containing section context) marks it as resolved
          const lower = line.toLowerCase();
          if (lower.includes('shipped') || lower.includes('addressed') || lower.includes('closed')) {
            // Resolved mention — skip
            continue;
          }
          const waveMatch = retroPath.match(/wave-(\d+)\.md$/);
          const waveName = waveMatch ? `wave-${waveMatch[1]}` : path.basename(retroPath);
          if (!retrosWithHit.includes(waveName)) retrosWithHit.push(waveName);
          break;
        }
      }
    }

    if (retrosWithHit.length >= 2) {
      const title = `anti-pattern recurrence: ${slug}`;
      if (addressed.has(title)) continue;
      concerns.push({
        title,
        severity: 'IMPORTANT',
        observed_in: retrosWithHit.join(', '),
        industry_misalignment: 'Google SRE Postmortem culture: recurring failures should decrease in frequency after documented in catalog',
        reason_not_surfaced: 'No session-start briefing existed before wave-155; recurrence was only detectable manually',
        proposed_wave: `wave-${(currentWave ?? 155) + 1}`,
        cost_of_silence: `${slug} will continue recurring — each recurrence costs 1–3 wave-cycles to detect and address`,
        status: 'open',
      });
    }
  }

  return concerns;
}

/**
 * Extract out-of-scope proposals from retros and surface any not yet logged.
 * @param {string[]} retroPaths
 * @param {Set<string>} addressed
 * @param {number | null} currentWave
 * @returns {Concern[]}
 */
function scanRetrosForOpenProposals(retroPaths, addressed, currentWave) {
  /** @type {Concern[]} */
  const concerns = [];

  for (const retroPath of retroPaths) {
    const content = readSafe(retroPath);
    if (!content) continue;
    const section = extractOutOfScopeSection(content);
    if (!section) continue;

    const waveMatch = retroPath.match(/wave-(\d+)\.md$/);
    const waveName = waveMatch ? `wave-${waveMatch[1]}` : path.basename(retroPath);

    // Each bullet point or numbered item is an unresolved proposal.
    // Require a space after the bullet marker so markdown HR (`---`) doesn't qualify.
    const items = section.split('\n').filter((l) => /^[-*]\s|^\d+\.\s/.test(l.trim()));
    for (const item of items) {
      const raw = item.replace(/^[-*\d.]\s*/, '').trim();
      // Skip empty or all-dash residue (markdown HR or stripped bullets)
      if (!raw || /^-+$/.test(raw)) continue;
      // Shorten long proposals to fit as title
      const title = `open-proposal (${waveName}): ${raw.slice(0, 80)}${raw.length > 80 ? '…' : ''}`;
      if (addressed.has(title)) continue;

      concerns.push({
        title,
        severity: 'NICE',
        observed_in: waveName,
        industry_misalignment: 'OKR proactive review: concerns raised in cadence, not only when they escalate',
        reason_not_surfaced: 'Out-of-scope proposals in retros were not tracked across sessions before wave-155',
        proposed_wave: 'TBD',
        cost_of_silence: 'Proposals from past retros drift into the audit backlog unchecked',
        status: 'open',
      });
    }
  }

  return concerns;
}

/**
 * Memory snapshot scanner — entities with wave-origin 5+ waves old, no resolution.
 * @param {Set<string>} addressed
 * @param {number | null} currentWave
 * @returns {Concern[]}
 */
function scanMemorySnapshot(addressed, currentWave) {
  const content = readSafe(MEMORY_SNAPSHOT_PATH);
  if (!content) {
    warn('docs/memory-anti-patterns.md not found — MCP snapshot signal skipped');
    return [];
  }
  if (currentWave === null) return [];

  /** @type {Concern[]} */
  const concerns = [];

  // Table rows: | `entity-name` | Type | Latest observation | Wave |
  for (const m of content.matchAll(/\|\s*`([^`]+)`\s*\|\s*(\w+)\s*\|\s*([^|]+)\|\s*([^|]+)\|/g)) {
    const entityName = m[1].trim();
    const entityType = m[2].trim();
    const latestObs = m[3].trim();
    const waveField = m[4].trim();

    // Extract wave number from waveField
    const waveMatch = waveField.match(/wave-(\d+)/);
    if (!waveMatch) continue;
    const waveOrigin = parseInt(waveMatch[1], 10);

    if (currentWave - waveOrigin < 5) continue;

    // Check for resolution markers in the observation
    const lower = latestObs.toLowerCase();
    if (lower.includes('resolved') || lower.includes('shipped') || lower.includes('addressed')) continue;

    const title = `memory-entity stale: ${entityName}`;
    if (addressed.has(title)) continue;

    concerns.push({
      title,
      severity: 'IMPORTANT',
      observed_in: `memory-anti-patterns.md (entity: ${entityName}, wave: ${waveField.trim()})`,
      industry_misalignment: 'NIST AI RMF Govern: continual risk monitoring, not point-in-time snapshot',
      reason_not_surfaced: `Memory entity ${entityName} (type: ${entityType}) has wave-origin ${waveOrigin}, current wave ${currentWave} — gap of ${currentWave - waveOrigin} waves with no resolution observation`,
      proposed_wave: `wave-${currentWave + 1}`,
      cost_of_silence: `Anti-pattern entity age ${currentWave - waveOrigin} waves: if unresolved, the pattern may continue recurring undetected`,
      status: 'open',
    });
  }

  return concerns;
}

// ---------------------------------------------------------------------------
// E3 — Severity escalation pass
// ---------------------------------------------------------------------------

/**
 * Apply escalation to new concerns if they appeared in a previous run
 * and have no log response.
 * @param {Concern[]} concerns
 * @param {Array<{title: string, severity: Severity, wave_origin: number}>} previousConcerns
 * @param {Set<string>} addressed
 * @param {number | null} currentWave
 * @returns {Concern[]}
 */
function applyEscalation(concerns, previousConcerns, addressed, currentWave) {
  if (currentWave === null) return concerns;

  const prevMap = new Map(previousConcerns.map((c) => [c.title, c]));

  return concerns.map((concern) => {
    const prev = prevMap.get(concern.title);
    if (!prev) return concern;
    if (addressed.has(concern.title)) return concern;
    if (currentWave - prev.wave_origin < 5) return concern;
    const escalated = escalate(prev.severity);
    if (escalated !== concern.severity) {
      return { ...concern, severity: escalated };
    }
    return concern;
  });
}

// ---------------------------------------------------------------------------
// Output formatter
// ---------------------------------------------------------------------------

/** @param {Concern} c */
function formatConcern(c) {
  return `## ${c.title}

- severity: ${c.severity}
- observed_in: ${c.observed_in}
- industry_misalignment: ${c.industry_misalignment}
- reason_not_surfaced: ${c.reason_not_surfaced}
- proposed_wave: ${c.proposed_wave}
- cost_of_silence: ${c.cost_of_silence}
- status: ${c.status}
`;
}

/**
 * Build the full output document.
 * @param {Concern[]} concerns
 * @param {string} triggeredBy
 * @returns {string}
 */
function buildOutput(concerns, triggeredBy) {
  const ts = new Date().toISOString();
  const sorted = [
    ...concerns.filter((c) => c.severity === 'BLOCKING'),
    ...concerns.filter((c) => c.severity === 'IMPORTANT'),
    ...concerns.filter((c) => c.severity === 'NICE'),
  ];

  if (sorted.length === 0) {
    return `# Proactive Surfacing — No Concerns Found

Generated: ${ts}
Triggered by: ${triggeredBy}

No concerns surfaced. All signal sources checked.
`;
  }

  const blocking = sorted.filter((c) => c.severity === 'BLOCKING').length;
  const important = sorted.filter((c) => c.severity === 'IMPORTANT').length;
  const nice = sorted.filter((c) => c.severity === 'NICE').length;

  const header = `# Proactive Surfacing — Concern Queue

Generated: ${ts}
Triggered by: ${triggeredBy}
Total: ${sorted.length} concerns (${blocking} BLOCKING, ${important} IMPORTANT, ${nice} NICE)

> Respond via: \`node scripts/surface-concerns.mjs --respond "<title>" <addressed|deferred|declined|disputed> [reason]\`
> Log: \`docs/audit-reports/surfaced-concerns-log.md\`
> Protocol: \`docs/PROACTIVE_SURFACING_PROTOCOL.md\`

---

`;

  return header + sorted.map(formatConcern).join('\n---\n\n');
}

// ---------------------------------------------------------------------------
// --respond handler
// ---------------------------------------------------------------------------

/**
 * Append a user response to the anti-suppression log.
 * @param {string[]} args remaining args after --respond
 * @param {number | null} currentWave
 */
function handleRespond(args, currentWave) {
  const validTypes = ['addressed', 'deferred', 'declined', 'disputed'];
  const [title, responseType, ...reasonParts] = args;

  if (!title || !responseType) {
    process.stderr.write('[surface-concerns] ERROR: --respond requires <title> <response-type> [reason]\n');
    process.exit(1);
  }

  if (!validTypes.includes(responseType.toLowerCase())) {
    process.stderr.write(`[surface-concerns] ERROR: invalid response-type "${responseType}". Must be one of: ${validTypes.join(', ')}\n`);
    process.exit(1);
  }

  const reason = reasonParts.length > 0 ? reasonParts.join(' ') : '—';
  const ts = new Date().toISOString();
  const waveLabel = currentWave !== null ? `wave-${currentWave}` : 'unknown';

  const row = `| ${ts} | ${title} | ${responseType.toLowerCase()} | ${reason} | ${waveLabel} |\n`;

  // Create log file with header if it doesn't exist
  if (!fs.existsSync(LOG_PATH)) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, `# Surfaced Concerns Log\n\nAppend-only. One row per user response.\n\n${LOG_HEADER}`, 'utf8');
  }

  fs.appendFileSync(LOG_PATH, row, 'utf8');
  info(`Response logged: "${title}" → ${responseType}`);
}

// ---------------------------------------------------------------------------
// MCP entity creation (best-effort, non-blocking)
// ---------------------------------------------------------------------------

/**
 * Attempt to create a ProactiveSurfacingRun memory entity.
 * Fails silently if MCP is unavailable.
 * @param {Concern[]} concerns
 * @param {string} triggeredBy
 */
async function createMcpEntity(concerns, triggeredBy) {
  const ts = new Date().toISOString().slice(0, 10);
  const entityName = `proactive-surfacing-run-${ts}`;

  const blocking = concerns.filter((c) => c.severity === 'BLOCKING').length;
  const important = concerns.filter((c) => c.severity === 'IMPORTANT').length;
  const nice = concerns.filter((c) => c.severity === 'NICE').length;

  // Dynamic MCP import — only succeeds in environments with MCP available.
  // On failure, log warning and return.
  try {
    // Attempt dynamic resolution — will throw if MCP module is unavailable.
    // The timeout guard below ensures we never block more than 5 seconds.
    const mcpPromise = Promise.resolve().then(() => {
      // In a Claude agent context with MCP tools available, this would call
      // mcp__memory__create_entities. Outside that context this block is a no-op.
      // The surface-concerns script is designed to run both inside and outside
      // Claude agent sessions — MCP availability is not guaranteed.
      warn(`MCP entity creation: ${entityName} (N=${concerns.length}, BLOCKING=${blocking}, IMPORTANT=${important}, NICE=${nice}, triggered-by=${triggeredBy}). Create manually if needed.`);
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('MCP timeout')), 5000)
    );

    await Promise.race([mcpPromise, timeoutPromise]);
  } catch {
    warn('MCP unavailable or timed out — entity creation skipped. Snapshot in docs/memory-anti-patterns.md is the fallback.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const isDry = args.includes('--dry');
  const respondIdx = args.indexOf('--respond');

  const currentWave = extractCurrentWave();

  // Handle --respond first (mutually exclusive with normal run)
  if (respondIdx !== -1) {
    handleRespond(args.slice(respondIdx + 1), currentWave);
    return;
  }

  // Determine trigger source
  const triggeredBy = isDry ? 'manual --dry' : (process.env.SURFACE_TRIGGER ?? 'manual');

  // Collect signals
  const retroPaths = getLastNRetros(10);
  const slugs = extractCatalogSlugs();
  const addressed = getAddressedTitles();
  const previousConcerns = getPreviousConcerns();

  // Run signal engines
  const antiPatternConcerns = scanRetrosForAntiPatterns(retroPaths, slugs, addressed, currentWave);
  const proposalConcerns = scanRetrosForOpenProposals(retroPaths, addressed, currentWave);
  const memoryConcerns = scanMemorySnapshot(addressed, currentWave);
  const industryConcerns = checkIndustryChecklist(currentWave ?? 155, addressed);

  // Deduplicate by title
  /** @type {Map<string, Concern>} */
  const deduped = new Map();
  for (const c of [...antiPatternConcerns, ...memoryConcerns, ...industryConcerns, ...proposalConcerns]) {
    if (!deduped.has(c.title)) deduped.set(c.title, c);
  }

  let concerns = Array.from(deduped.values());

  // Apply E3 severity escalation
  concerns = applyEscalation(concerns, previousConcerns, addressed, currentWave);

  const output = buildOutput(concerns, triggeredBy);

  if (isDry) {
    process.stdout.write(output + '\n');
    return;
  }

  // Atomic write: write to .tmp then rename
  const tmpPath = OUTPUT_PATH + '.tmp';
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(tmpPath, output, 'utf8');
  fs.renameSync(tmpPath, OUTPUT_PATH);

  info(`Written: ${OUTPUT_PATH} (${concerns.length} concerns)`);

  // Wave-158 — Andon Cord: halt pipeline if any concern is severity: blocking
  // Gate: only fires when andonCord.hardBlockEnabled: true (default: false = soft mode)
  const blockingConcerns = concerns.filter((c) => c.severity === 'BLOCKING');
  if (blockingConcerns.length > 0) {
    let hardBlockEnabled = false;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.sdd-config.json'), 'utf8'));
      hardBlockEnabled = Boolean(cfg?.andonCord?.hardBlockEnabled);
    } catch { /* config unreadable — default false */ }

    if (hardBlockEnabled) {
      // Dynamic import to avoid circular dependency at module load time
      const { writeHaltState } = await import('./andon-halt-helpers.mjs');
      const firstBlocking = blockingConcerns[0];
      const currentWaveArg = process.argv.find((a) => a.startsWith('wave-')) ?? 'unknown';
      writeHaltState(
        currentWaveArg,
        'proactive-surfacing-agent',
        `BLOCKING concern surfaced: ${firstBlocking.title}`
      );
      // writeHaltState calls process.exit(42) — code below is unreachable
    } else {
      process.stderr.write(
        `[surface-concerns] WARN — ${blockingConcerns.length} BLOCKING concern(s) found but andonCord.hardBlockEnabled: false.\n` +
        `  Set andonCord.hardBlockEnabled: true in .sdd-config.json to auto-halt on blocking concerns.\n`
      );
    }
  }

  // Best-effort MCP entity
  await createMcpEntity(concerns, triggeredBy);
}

main().catch((err) => {
  process.stderr.write(`[surface-concerns] FATAL: ${err.message}\n`);
  process.exit(1);
});
