#!/usr/bin/env node
// serve.mjs — jidoka dashboard server (docs/DASHBOARD_SPEC.md AC4/AC5).
// http + /api/* + SSE live watch. Entry: npm run jidoka:dashboard.
//
// Usage: node scripts/dashboard/serve.mjs            (port 7717, or JIDOKA_DASHBOARD_PORT)

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { discoverProjects, collectProject } from './collectors.mjs';
import { snapshotMarkdown } from './gdoc-export.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = dirname(dirname(HERE)); // scripts/dashboard → framework root
const HOME = homedir();
const PORT = Number(process.env.JIDOKA_DASHBOARD_PORT) || 7717;

const projects = () => discoverProjects(HOME, FRAMEWORK);
const byName = (name) => projects().find((p) => p.name === name);
const json = (res, obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

const sseClients = new Set();

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(readFileSync(join(HERE, 'ui.html'), 'utf8'));
  }
  if (url.pathname === '/api/projects') return json(res, projects());

  if (url.pathname === '/api/data') {
    const p = byName(url.searchParams.get('project'));
    if (!p) { res.writeHead(404); return res.end('unknown project'); }
    const d = collectProject(p.path);
    d.collectedAt = new Date().toISOString();
    return json(res, { project: p, ...d });
  }

  if (url.pathname === '/api/export') {
    const p = byName(url.searchParams.get('project'));
    if (!p) { res.writeHead(404); return res.end('unknown project'); }
    const md = snapshotMarkdown(p, collectProject(p.path));
    const out = join(p.path, 'docs/dashboard-snapshot.md');
    try { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, md); } catch { /* */ }
    return json(res, { path: out, message: `Snapshot saved → ${out}\n(GDoc: wire a Google Docs MCP to push this markdown straight into a doc)` });
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    const client = { res, project: url.searchParams.get('project') };
    sseClients.add(client);
    req.on('close', () => sseClients.delete(client));
    return;
  }

  res.writeHead(404); res.end('not found');
});

// Live watch: artifact changes push an SSE 'update' to clients on that project.
function watchProjects() {
  let n = 0;
  for (const p of projects()) {
    for (const rel of ['docs/audits', 'docs/governance', '.jidoka/audits']) {
      const dir = join(p.path, rel);
      if (!existsSync(dir)) continue;
      try {
        watch(dir, { persistent: false }, () => {
          for (const c of sseClients) {
            if (c.project === p.name) c.res.write(`event: update\ndata: ${JSON.stringify({ project: p.name })}\n\n`);
          }
        });
        n++;
      } catch { /* watch limit / unsupported fs */ }
    }
  }
  return n;
}

server.listen(PORT, () => {
  const watched = watchProjects();
  const target = `http://localhost:${PORT}`;
  console.log(`\n  🦞 jidoka dashboard → ${target}`);
  console.log(`  ${projects().length} projects · ${watched} live watchers · Ctrl-C to stop\n`);
  // Auto-open the browser so the dashboard is never just a URL in a log (opt out: JIDOKA_DASHBOARD_NO_OPEN=1).
  if (!process.env.JIDOKA_DASHBOARD_NO_OPEN) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${opener} ${target}`, () => { /* best-effort; headless/no-DISPLAY is fine */ });
  }
});
