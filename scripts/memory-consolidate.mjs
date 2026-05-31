#!/usr/bin/env node
// Memory consolidation — turns the raw cross-project mistake ledger (EPISODIC memory: one row
// per incident) into a ranked "what we've learned" digest (SEMANTIC memory: one lesson per class,
// weighted by how often and how recently it bites). This is the digest the orchestrator reads at
// session start instead of re-reading every raw row.
//
// One scoring mechanism covers three AC at once:
//   score(class) = Σ over its incidents of  0.5 ^ (ageDays / HALF_LIFE)
//   • FREQUENCY (AC-6.2): more incidents → more terms in the sum → higher score.
//   • RECENCY  (AC-6.2): a fresh incident weighs ~1.0; the weight halves every HALF_LIFE days.
//   • DECAY    (AC-6.3): a lesson untouched for several half-lives contributes ~0 and is demoted.
// It cross-references meta-remedies so each lesson shows whether a GATE already holds it (closed
// loop) or it is still a live, ungated risk.
//
// FULL & self-tested. Usage:
//   node scripts/memory-consolidate.mjs            # consolidate global ledger → memory-consolidated.md
//   node scripts/memory-consolidate.mjs --self-test
//   META_LEDGER=… MEMORY_OUT=… META_TODAY=… node scripts/memory-consolidate.mjs   # overrides

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadLedger, groupByClass, daysBetween, todayISO } from './meta-lib.mjs';
import { REMEDIES } from './meta-remedies.mjs';

export const HALF_LIFE = 30;   // days — an incident's weight halves every 30 days
export const ACTIVE = 1.5;     // score ≥ → 🔴 front-of-mind
export const WATCH = 0.5;      // score ≥ → 🟡 keep an eye; below → 🟪 decayed/demoted

const GLOBAL = join(homedir(), '.claude', 'jidoka');
const INPUT = process.env.META_LEDGER || join(GLOBAL, 'meta-mistakes.jsonl');
const OUTPUT = process.env.MEMORY_OUT || join(GLOBAL, 'memory-consolidated.md');
const RETROS_DIR = process.env.RETROS_DIR || 'docs/retros';

// recency-weighted frequency: frequency, recency, and decay in one sum.
export function scoreCluster(incidents, today) {
  return incidents.reduce((s, it) => s + Math.pow(0.5, Math.max(0, daysBetween(it.date, today)) / HALF_LIFE), 0);
}

const tierOf = (score) => (score >= ACTIVE ? 'ACTIVE' : score >= WATCH ? 'WATCH' : 'DORMANT');

// EPISODIC rows → SEMANTIC clusters, ranked by recency-weighted frequency.
export function consolidate(rows, today = todayISO(), remedies = REMEDIES) {
  // map every gated class AND its remedy family to the gate that covers it
  const familyGate = {};
  for (const [cls, r] of Object.entries(remedies)) {
    familyGate[cls] = cls;
    for (const f of (r.family || [])) if (!familyGate[f]) familyGate[f] = cls;
  }
  const byClass = groupByClass(rows);
  const clusters = Object.entries(byClass).map(([cls, items]) => {
    const sorted = [...items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
    const score = scoreCluster(items, today);
    const gateCls = familyGate[cls] || null;
    const gate = gateCls ? remedies[gateCls] : null;
    return {
      cls, count: items.length, score: Math.round(score * 1000) / 1000, tier: tierOf(score),
      last: sorted[0].date, lastAge: daysBetween(sorted[0].date, today),
      projects: [...new Set(items.map(i => i.project).filter(Boolean))].sort(),
      gated: !!gate, gateMechanism: gate ? gate.mechanism : null,
      gateVia: gate && gateCls !== cls ? gateCls : null,
      examples: sorted.slice(0, 2).map(i => ({ date: i.date, claimed: i.claimed, real: i.real, caught_by: i.caught_by })),
    };
  }).sort((a, b) => b.score - a.score || (a.cls < b.cls ? -1 : 1)); // stable: score desc, then class asc
  return { today, total: rows.length, classes: clusters.length, clusters };
}

// secondary EPISODIC source: retro files (gracefully empty when none exist yet)
export function scanRetros(dir = RETROS_DIR) {
  if (!existsSync(dir)) return { scanned: 0, lessons: [] };
  const files = readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  const lessons = [];
  const marker = /(lesson|takeaway|root cause|what we learned)/i;
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (marker.test(lines[i]) && /^#{1,4}\s/.test(lines[i])) {
        const body = lines.slice(i + 1).find(l => l.trim() && !/^#{1,4}\s/.test(l));
        if (body) lessons.push({ file: f, text: body.trim().replace(/^[-*]\s*/, '') });
      }
    }
  }
  return { scanned: files.length, lessons };
}

const ICON = { ACTIVE: '🔴', WATCH: '🟡', DORMANT: '🟪' };

function renderLesson(c) {
  const gate = c.gated
    ? `✓ gated by \`${c.gateMechanism}\`${c.gateVia ? ` (family of ${c.gateVia})` : ''}`
    : '⚠ **ungated — still a live risk**';
  const proj = c.projects.length ? ` · ${c.projects.join(', ')}` : '';
  const ex = c.examples.map(e => `  - \`${e.date}\` claimed *"${e.claimed}"* → really *"${e.real}"* (caught by ${e.caught_by})`).join('\n');
  return `### ${c.cls}  ·  score ${c.score}  ·  seen ${c.count}×  ·  last ${c.lastAge}d ago${proj}\n${gate}\n${ex}`;
}

export function render(model, retro = { scanned: 0, lessons: [] }) {
  const byTier = t => model.clusters.filter(c => c.tier === t);
  const section = (title, t) => {
    const items = byTier(t);
    if (!items.length) return '';
    return `\n## ${ICON[t]} ${title}\n\n${items.map(renderLesson).join('\n\n')}\n`;
  };
  const retroBlock = retro.lessons.length
    ? `\n## 📓 From retros (${retro.scanned} scanned)\n\n${retro.lessons.map(l => `- ${l.text}  \`${l.file}\``).join('\n')}\n`
    : (retro.scanned ? `\n_${retro.scanned} retro(s) scanned, no structured lessons extracted._\n` : '');
  return [
    `# Consolidated memory — what we've learned`,
    ``,
    `_Generated ${model.today} from ${model.total} episodes across ${model.classes} classes. Read this at session start._`,
    ``,
    `Episodic memory = each raw incident in the ledger. Semantic memory = these per-class lessons,`,
    `ranked by recency-weighted frequency (weight halves every ${HALF_LIFE}d). A lesson seen often and`,
    `recently ranks high; an old one-off decays and is demoted. Gated lessons already have a mechanism`,
    `holding them; ungated ones are live risks worth a gate.`,
    section('Active — front of mind', 'ACTIVE'),
    section('Watch — recurring but lower-pressure', 'WATCH'),
    section('Decayed — demoted (old / one-off)', 'DORMANT'),
    retroBlock,
  ].join('\n');
}

function selfTest() {
  const today = '2026-06-01';
  const rows = [
    // hot: 3 recent incidents → high frequency + recency
    { date: '2026-05-30', class: 'hot', claimed: 'a', real: 'b', caught_by: 'self', project: 'p1' },
    { date: '2026-05-25', class: 'hot', claimed: 'a', real: 'b', caught_by: 'self', project: 'p2' },
    { date: '2026-05-20', class: 'hot', claimed: 'a', real: 'b', caught_by: 'self', project: 'p1' },
    // medium: single recent incident
    { date: '2026-05-30', class: 'medium', claimed: 'a', real: 'b', caught_by: 'self' },
    // stale: single ~5-month-old incident → must decay to DORMANT
    { date: '2026-01-01', class: 'stale', claimed: 'a', real: 'b', caught_by: 'self' },
    // gated class (has a remedy) + a family child (covered by the parent gate)
    { date: '2026-05-30', class: 'declaration-over-implementation', claimed: 'a', real: 'b', caught_by: 'user' },
    { date: '2026-05-29', class: 'claim-without-test', claimed: 'a', real: 'b', caught_by: 'user' },
  ];
  const m = consolidate(rows, today);
  const get = cls => m.clusters.find(c => c.cls === cls);
  const out = render(m, scanRetros('/does/not/exist'));
  const m2 = consolidate(rows, today);
  const T = [
    ['hot ranks first (recency+frequency)', m.clusters[0].cls === 'hot'],
    ['hot > medium (frequency: 3 recent beats 1)', get('hot').score > get('medium').score],
    ['hot is ACTIVE', get('hot').tier === 'ACTIVE'],
    ['medium is WATCH (single recent)', get('medium').tier === 'WATCH'],
    ['stale decayed to DORMANT (old one-off)', get('stale').tier === 'DORMANT'],
    ['gated class shows its mechanism', get('declaration-over-implementation').gated && !!get('declaration-over-implementation').gateMechanism],
    ['family child gated via parent', get('claim-without-test').gateVia === 'declaration-over-implementation'],
    ['deterministic (same input → same output)', JSON.stringify(m) === JSON.stringify(m2)],
    ['render emits the active marker + header', out.includes('🔴') && out.includes("what we've learned")],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mmemory-consolidate self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ memory-consolidate clusters + weights + decays correctly\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
if (process.argv.includes('--self-test')) selfTest();

// CLI: read episodic ledger → consolidate → write semantic digest
if (!existsSync(INPUT)) { console.error(`memory-consolidate: ledger not found at ${INPUT}`); process.exit(2); }
const rows = loadLedger(INPUT);
const model = consolidate(rows);
const retro = scanRetros();
const md = render(model, retro);
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, md);
const top = model.clusters.slice(0, 3).map(c => `${c.cls}(${c.score})`).join(', ');
console.log(`memory-consolidate: ${model.total} episodes → ${model.classes} semantic lessons → ${OUTPUT}`);
console.log(`  top: ${top || '—'}   retros scanned: ${retro.scanned}`);
process.exit(0);
}
