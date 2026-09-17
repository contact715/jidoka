#!/usr/bin/env node
// serve.mjs — jidoka dashboard server (docs/DASHBOARD_SPEC.md AC4/AC5).
// http + /api/* + SSE live watch. Entry: npm run jidoka:dashboard.
//
// Port: 7717, or PORT / JIDOKA_DASHBOARD_PORT. `--emit-html [project]` prints the HTML snapshot
// to stdout without starting the server. Usage:
//   node scripts/dashboard/serve.mjs
//   node scripts/dashboard/serve.mjs --emit-html

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, networkInterfaces } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { discoverProjects, collectProject } from './collectors.mjs';
import { snapshotMarkdown, snapshotHtml } from './gdoc-export.mjs';
import { runCli, formatUsage, EXIT_USAGE } from '../lib/cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = dirname(dirname(HERE)); // scripts/dashboard → framework root
const HOME = homedir();
// Honor the standard PORT env var (the Claude preview harness assigns a free port this way), then our
// own JIDOKA_DASHBOARD_PORT, else the default. An explicit port is respected strictly (no fallback).
const EXPLICIT_PORT = process.env.PORT || process.env.JIDOKA_DASHBOARD_PORT;
const PORT = Number(EXPLICIT_PORT) || 7717;
// Optional HTTP basic-auth: set JIDOKA_DASHBOARD_AUTH="user:pass" to require it on EVERY request
// (used when the board is exposed via a public tunnel). Unset = no auth (local default — unchanged).
const AUTH = process.env.JIDOKA_DASHBOARD_AUTH || '';
const AUTH_WANT = AUTH ? Buffer.from('Basic ' + Buffer.from(AUTH).toString('base64')) : null;
function authOk(req) {
  if (!AUTH_WANT) return true;
  const got = Buffer.from(req.headers.authorization || '');
  return got.length === AUTH_WANT.length && timingSafeEqual(got, AUTH_WANT);
}

const projects = () => discoverProjects(HOME, FRAMEWORK);
const byName = (name) => projects().find((p) => p.name === name);
const json = (res, obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

const sseClients = new Set();

// Запрос к панели. Сервер создаётся только при запуске (createDashboardServer), не при импорте:
// импорт модуля ради разбора аргументов или сверки мест вызова не должен поднимать HTTP.
function handle(req, res) {
  if (!authOk(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="jidoka dashboard"' });
    return res.end('auth required');
  }
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
}

export function createDashboardServer() {
  return createServer(handle);
}

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

// CLI: `--emit-html [project]` prints the GDoc-ready HTML snapshot to stdout (for the Claude/cron
// MCP push into a real Google Doc), then exits without starting the server. Default: the framework.
// Разбор строгий (2026-09-16): незнакомый флаг или лишнее слово — код 2 до запуска сервера.
export const CLI = {
  name: 'serve',
  path: 'scripts/dashboard/serve.mjs',
  usage: `Панель jidoka.

Поднять HTTP-сервер (порт 7717, PORT или JIDOKA_DASHBOARD_PORT):
  node scripts/dashboard/serve.mjs

Напечатать HTML-снимок проекта в stdout, сервер не поднимается (без имени проекта — фреймворк):
  node scripts/dashboard/serve.mjs --emit-html [проект]

Флаги:
      --emit-html   напечатать HTML-снимок и выйти
  -h, --help        эта справка`,
  options: {
    'emit-html': { type: 'boolean', desc: 'напечатать HTML-снимок проекта в stdout и выйти, сервер не поднимать' },
  },
  positionals: { min: 0, max: 1, name: 'проект' },
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const { values, positionals } = runCli(CLI);
  if (positionals.length && !values['emit-html']) {
    process.stderr.write(`serve: неверный вызов — имя проекта принимается только вместе с --emit-html\nНичего не выполнено.\n\n${formatUsage(CLI, 'serve')}\n`);
    process.exit(EXIT_USAGE);
  }
  if (values['emit-html']) {
    const arg = positionals[0];
    const list = projects();
    const p = arg ? byName(arg) : (list.find((x) => x.kind === 'framework') || list[0]);
    if (!p) { console.error('emit-html: no project found'); process.exit(1); }
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    process.stdout.write(snapshotHtml(p, collectProject(p.path), stamp));
    process.exit(0);
  }

  // Auto-fallback: if the default port is taken (a stray server, another app), step to the next free
  // one instead of crashing on EADDRINUSE — so `npm run dashboard` always comes up.
  const server = createDashboardServer();
  let boundPort = PORT;
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && !EXPLICIT_PORT && boundPort < PORT + 12) {
      console.log(`  ⚠ port ${boundPort} busy — trying ${boundPort + 1}…`);
      boundPort += 1;
      setTimeout(() => server.listen(boundPort), 120);
    } else {
      console.error(`  dashboard could not start: ${e.message}`);
      process.exit(1);
    }
  });
  server.listen(boundPort, () => {
    const watched = watchProjects();
    const target = `http://localhost:${boundPort}`;
    console.log(`\n  🦞 jidoka dashboard → ${target}`);
    // LAN address so the board opens on an iPad / phone on the same Wi-Fi (server binds all interfaces).
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) console.log(`  📱 iPad / телефон (та же Wi-Fi): http://${lan.address}:${boundPort}`);
    console.log(`  ${projects().length} projects · ${watched} live watchers · Ctrl-C to stop\n`);
    // Auto-open the browser so the dashboard is never just a URL in a log (opt out: JIDOKA_DASHBOARD_NO_OPEN=1).
    // Skip under the preview harness (PORT set) — it renders the page itself, no extra browser window.
    if (!process.env.JIDOKA_DASHBOARD_NO_OPEN && !process.env.PORT) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
      exec(`${opener} ${target}`, () => { /* best-effort; headless/no-DISPLAY is fine */ });
    }
  });
}
