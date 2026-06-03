#!/usr/bin/env node
// gdoc-export.mjs — render a shareable snapshot of a project's jidoka state (DASHBOARD_SPEC AC6).
// Produces markdown now (written to a file the user can paste/sync into a Google Doc); when a
// Google Docs MCP/connector is wired, push() sends the same markdown straight into a doc.

export function snapshotMarkdown(project, data) {
  const h = data.health;
  const lines = [
    `# ${project.name} — jidoka snapshot`,
    '',
    `**Branch:** ${data.pipeline.branch || '—'}  ·  **Health:** ${h.level.toUpperCase()} (eval ${h.evalPct ?? '—'}%, recent fails ${h.recentFails})  ·  ${h.halt ? 'HALTED' : 'running'}`,
    '',
    `## Dev-pipeline (${data.pipeline.stageCount} stages)`,
    ...(data.pipeline.stages.length ? data.pipeline.stages.map((s) => `- ${s.label}`) : ['- (no RACI stages)']),
    '',
    `## Production`,
    `- ${data.production.deployCount} deploy event(s)`,
    '',
    `## Что висит (${data.tasks.length})`,
    ...(data.tasks.length ? data.tasks.map((t) => `- [${t.priority}] ${t.source}: ${t.text}`) : ['- всё чисто']),
    '',
  ];
  return lines.join('\n');
}

function selfTest() {
  const md = snapshotMarkdown(
    { name: 'demo' },
    { pipeline: { branch: 'main', stageCount: 1, stages: [{ label: 'Impl' }] }, production: { deployCount: 2 }, tasks: [{ priority: 'high', source: 'gate', text: 'x failed' }], health: { level: 'amber', evalPct: 90, recentFails: 1, halt: false } }
  );
  let f = 0;
  const ok = (n, c) => { if (!c) f++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  ok('has project title', md.includes('# demo — jidoka snapshot'));
  ok('renders branch + health', md.includes('main') && md.includes('AMBER'));
  ok('lists pipeline stage', md.includes('- Impl'));
  ok('lists hanging task with priority + source', md.includes('[high] gate: x failed'));
  if (f) { console.log(`\n\x1b[31mgdoc-export self-test FAILED (${f})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ gdoc-export: snapshot markdown correct\x1b[0m'); process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();
