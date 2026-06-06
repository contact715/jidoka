#!/usr/bin/env node
// gdoc-export.mjs — render a shareable snapshot of a project's jidoka state (DASHBOARD_SPEC AC6).
// snapshotMarkdown(): plain snapshot serve.mjs writes to docs/dashboard-snapshot.md.
// snapshotHtml(): rich HTML the Google Drive MCP imports straight into a real Google Doc
//   (text/html → application/vnd.google-apps.document — native headings, table, lists).
//   The node server cannot call MCP itself, so the push is driven by Claude on request
//   (or a scheduled Claude run). serve.mjs --emit-html prints the HTML for that push.

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

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const STAGE_MARK = { done: '✓', running: '▶', pending: '○' };

function stagesHtml(pipeline) {
  return (pipeline.stages || []).map((s) => {
    const mark = STAGE_MARK[s.status] || '○';
    const cur = s.current ? ' <b>← сейчас</b>' : '';
    const acted = (s.agents || []).filter((a) => a.outcome);
    const out = acted.length ? ` (${acted.map((a) => `${esc(a.name)}: ${esc(a.outcome)}`).join(', ')})` : '';
    return `<li>${mark} ${esc(s.label)}${cur}${out}</li>`;
  }).join('');
}

function tasksHtml(tasks) {
  if (!tasks || !tasks.length) return '<p>всё чисто</p>';
  const rows = tasks.map((t) => `<tr><td>${esc(t.priority)}</td><td>${esc(t.source)}</td><td>${esc(t.text)}</td></tr>`).join('');
  return `<table border="1" cellpadding="6"><tr><td><b>Приоритет</b></td><td><b>Источник</b></td><td><b>Что висит</b></td></tr>${rows}</table>`;
}

function prodHtml(production) {
  const bands = (production.events || []).map((e) => e.payload && `${e.payload.metric}: ${e.payload.band}`).filter(Boolean);
  const list = bands.length ? `<ul>${bands.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
  return `<p>${production.deployCount ?? 0} deploy event(s)</p>${list}`;
}

// Rich HTML snapshot → imported by the Drive MCP as a native Google Doc. `now` is passed in
// (never computed here) so the renderer stays pure and testable.
export function snapshotHtml(project, data, now = '') {
  const h = data.health || {};
  const p = data.pipeline || {};
  const lessons = (data.lessons || []).map((l) => `<li>${esc(l.class)} ×${l.count}</li>`).join('');
  const timeline = (data.timeline || []).slice(0, 6).map((t) => `<li>${esc(t.hash)} — ${esc(t.subject)} <i>(${esc(t.when)})</i></li>`).join('');
  return [
    `<h1>${esc(project.name)} — jidoka snapshot</h1>`,
    now ? `<p><i>${esc(now)}</i></p>` : '',
    `<p><b>Branch:</b> ${esc(p.branch || '—')} · <b>Health:</b> ${esc((h.level || '—').toUpperCase())} `
      + `(eval ${h.evalPct ?? '—'}%, recent fails ${h.recentFails ?? '—'}) · ${h.halt ? 'HALTED' : 'running'}`
      + (p.wave ? ` · <b>Wave:</b> ${esc(p.wave)} (${p.progress ?? 0}%)` : '') + '</p>',
    `<h2>Dev-pipeline (${p.stageCount ?? (p.stages || []).length} stages)</h2>`,
    `<ul>${stagesHtml(p)}</ul>`,
    '<h2>Production</h2>',
    prodHtml(data.production || {}),
    `<h2>Что висит (${(data.tasks || []).length})</h2>`,
    tasksHtml(data.tasks),
    lessons ? `<h2>Активные мета-уроки (риск повторов)</h2><ul>${lessons}</ul>` : '',
    timeline ? `<h2>Недавнее</h2><ul>${timeline}</ul>` : '',
  ].filter(Boolean).join('\n');
}

function selfTest() {
  const DEMO = {
    pipeline: { branch: 'main', stageCount: 1, wave: 'wave-x', progress: 57, stages: [{ label: 'Impl', status: 'running', current: true, agents: [{ name: 'security-scanner', outcome: 'FAIL' }] }] },
    production: { deployCount: 2, events: [{ payload: { metric: 'Lead Time', band: 'Elite' } }] },
    tasks: [{ priority: 'high', source: 'gate', text: 'x <failed> & broke' }],
    lessons: [{ class: 'self-test-blindspot', count: 3 }],
    timeline: [{ hash: 'a52ea0f', subject: 'feat: keystone', when: '54 minutes ago' }],
    health: { level: 'amber', evalPct: 90, recentFails: 1, halt: false },
  };
  const md = snapshotMarkdown({ name: 'demo' }, DEMO);
  const html = snapshotHtml({ name: 'demo' }, DEMO, '2026-01-01');
  let f = 0;
  const ok = (n, c) => { if (!c) f++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  ok('md: has project title', md.includes('# demo — jidoka snapshot'));
  ok('md: renders branch + health', md.includes('main') && md.includes('AMBER'));
  ok('md: lists pipeline stage', md.includes('- Impl'));
  ok('md: lists hanging task with priority + source', md.includes('[high] gate: x <failed> & broke'));
  ok('html: native h1 title', html.includes('<h1>demo — jidoka snapshot</h1>'));
  ok('html: branch + health + wave', html.includes('<b>Branch:</b> main') && html.includes('AMBER') && html.includes('wave-x'));
  ok('html: stage marked current with agent outcome', html.includes('Impl') && html.includes('← сейчас') && html.includes('security-scanner: FAIL'));
  ok('html: task in table, escaped', html.includes('<td>high</td>') && html.includes('x &lt;failed&gt; &amp; broke'));
  ok('html: active lessons surfaced', html.includes('self-test-blindspot ×3'));
  if (f) { console.log(`\n\x1b[31mgdoc-export self-test FAILED (${f})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ gdoc-export: markdown + html snapshots correct\x1b[0m'); process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();
