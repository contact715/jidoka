#!/usr/bin/env node
// cl-launcher.mjs — the brain behind the `cl` project launcher.
// Turns the dumb project list into a status-aware cockpit: a traffic-light per
// project, a rich preview, a portfolio overview, and a read-only guard.
//
// Subcommands:
//   list                 emit fzf-ready rows (dot + name + tag <TAB> path), recency-sorted
//   preview <path>       emit the rich preview panel for one project
//   portfolio            emit the full status table for all projects (cl -s)
//   guard <path>         exit 3 if the project is read-only, else 0
//   selftest             run the built-in assertions, exit 0/1
//
// Reads the project list from $CL_PROJECTS_LIST or ~/.claude/projects.list.
// Every git/fs probe is best-effort and never throws — a missing/odd project
// degrades to a gray dot, it never breaks the launcher.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const LIST_PATH = process.env.CL_PROJECTS_LIST || join(HOME, '.claude/projects.list');

// ---------- pure helpers (unit-tested in selfTest) ----------

export function parseList(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('\t');
      if (i < 0) return null;
      return { name: l.slice(0, i).trim(), path: l.slice(i + 1).trim() };
    })
    .filter(Boolean);
}

export function isReadonly(name) {
  return /read-?only/i.test(name);
}

export function parseGitStatus(out) {
  if (!out) return { isGit: false, branch: '', ahead: 0, behind: 0, dirty: 0 };
  let branch = '';
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head')) branch = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.ab')) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) { ahead = +m[1]; behind = +m[2]; }
    } else if (line && !line.startsWith('#')) dirty++;
  }
  return { isGit: true, branch, ahead, behind, dirty };
}

// Decide the traffic-light dot + a one-word tag for a project.
export function level(st, halt) {
  if (halt) return { dot: '🔴', tag: 'HALT' };
  if (!st.isGit) return { dot: '⚪', tag: 'не git' };
  if (st.dirty > 0) return { dot: '🟡', tag: `${st.dirty} изм.` };
  if (st.behind > 0) return { dot: '🟡', tag: `↓${st.behind} позади` };
  if (st.ahead > 0) return { dot: '🟡', tag: `↑${st.ahead} не запушено` };
  return { dot: '🟢', tag: 'чисто' };
}

// ---------- impure probes (best-effort, never throw) ----------

function sh(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim();
  } catch {
    return '';
  }
}

function gitStatus(path) {
  if (!existsSync(path)) return { isGit: false, branch: '', ahead: 0, behind: 0, dirty: 0 };
  return parseGitStatus(sh('git status --porcelain=v2 --branch', path));
}

function lastCommit(path) {
  const s = sh('git log -1 --format=%ct%x1f%cr%x1f%s', path);
  if (!s) return null;
  const [ct, rel, subj] = s.split('\x1f');
  return { ts: +ct || 0, rel: rel || '', subj: subj || '' };
}

function haltState(path) {
  for (const p of ['docs/audits/andon-halt.json', 'docs/audits/halt-state.json']) {
    if (existsSync(join(path, p))) return true;
  }
  return false;
}

function evalPct(path) {
  try {
    return Math.round(JSON.parse(readFileSync(join(path, 'docs/evals/_baseline.json'), 'utf8')).pass_rate * 100);
  } catch {
    return null;
  }
}

// Newest spec file name = a hint of the current/last wave in flight.
function currentWave(path) {
  const specs = join(path, 'docs/specs');
  if (!existsSync(specs)) return null;
  const out = sh(`ls -t "${specs}"/*.md 2>/dev/null | head -1`, path);
  if (!out) return null;
  return out.split('/').pop().replace(/\.md$/, '');
}

// ---------- row assembly ----------

function buildRows() {
  let text = '';
  try { text = readFileSync(LIST_PATH, 'utf8'); } catch { return []; }
  const rows = parseList(text).filter((p) => existsSync(p.path)).map((p) => {
    const st = gitStatus(p.path);
    const halt = haltState(p.path);
    const ro = isReadonly(p.name);
    const lc = st.isGit ? lastCommit(p.path) : null;
    const lv = level(st, halt);
    return { ...p, st, halt, ro, lc, lv, ts: lc ? lc.ts : 0 };
  });
  rows.sort((a, b) => b.ts - a.ts); // smart ordering: most recently touched first
  return rows;
}

// ---------- subcommands ----------

function cmdList() {
  for (const r of buildRows()) {
    const lock = r.ro ? '🔒' : '';
    const field1 = `${lock}${r.lv.dot} ${r.name}  ·  ${r.lv.tag}`;
    process.stdout.write(`${field1}\t${r.path}\n`);
  }
}

function cmdPreview(path) {
  const rows = buildRows();
  const r = rows.find((x) => x.path === path) || { name: path.split('/').pop(), path, ro: isReadonly(path) };
  const st = r.st || gitStatus(path);
  const lc = r.lc !== undefined ? r.lc : lastCommit(path);
  const halt = r.halt !== undefined ? r.halt : haltState(path);
  const lv = r.lv || level(st, halt);
  const lines = [];
  lines.push(`${lv.dot} ${r.name}`);
  lines.push(path);
  lines.push('');
  if (r.ro) lines.push('🔒 READ-ONLY — пуш запрещён, только локально');
  if (halt) lines.push('🔴 HALT — открой docs/audits/');
  if (st.isGit) {
    lines.push(`ветка: ${st.branch || '—'}`);
    const sync = [];
    if (st.behind > 0) sync.push(`↓${st.behind} позади`);
    if (st.ahead > 0) sync.push(`↑${st.ahead} не запушено`);
    lines.push(`синхр.: ${sync.length ? sync.join('  ') : 'в ногу с remote'}`);
    lines.push(`изменения: ${st.dirty > 0 ? `${st.dirty} файл(ов) не закоммичено` : 'нет, чисто'}`);
    if (lc) lines.push(`последний коммит: ${lc.rel} — ${lc.subj}`);
  } else {
    lines.push('(не git-репозиторий)');
  }
  const pct = evalPct(path);
  if (pct !== null) lines.push(`eval baseline: ${pct === 100 ? '🟢' : '🟡'} ${pct}%`);
  const wave = currentWave(path);
  if (wave) {
    lines.push('');
    lines.push(`▶ последняя волна: ${wave}`);
    if (st.dirty > 0 || halt) lines.push('  → есть незавершённое: jidoka-resume продолжит');
  }
  lines.push('');
  lines.push('— файлы —');
  lines.push(sh('ls', path) || '(пусто)');
  process.stdout.write(lines.join('\n') + '\n');
}

function cmdPortfolio() {
  const rows = buildRows();
  const attn = rows.filter((r) => r.halt || (r.st.isGit && (r.st.dirty > 0 || r.st.behind > 0 || r.st.ahead > 0)));
  const out = [];
  out.push(`КОКПИТ — ${rows.length} проектов${attn.length ? `,  ${attn.length} требуют внимания` : ', всё зелёное'}`);
  out.push('');
  const nameW = Math.min(34, Math.max(...rows.map((r) => r.name.length)) + 2);
  const cell = (s, w) => String(s).slice(0, w - 1).padEnd(w);
  for (const r of rows) {
    const lock = r.ro ? '🔒' : '  ';
    const name = cell(r.name, nameW);
    const branch = cell(r.st.branch || '—', 16);
    const tag = cell(r.lv.tag, 18);
    const when = r.lc ? r.lc.rel : '';
    out.push(`${lock}${r.lv.dot} ${name}${branch}${tag}${when}`);
  }
  if (attn.length) {
    out.push('');
    out.push('внимание: ' + attn.map((r) => `${r.name} (${r.lv.tag})`).join(', '));
  }
  process.stdout.write(out.join('\n') + '\n');
}

function cmdGuard(path) {
  const rows = buildRows();
  const r = rows.find((x) => x.path === path);
  const ro = r ? r.ro : isReadonly(path);
  if (ro) {
    process.stderr.write('🔒 Этот проект READ-ONLY (backend/прод). Пуш и правки запрещены.\n');
    process.exit(3);
  }
  process.exit(0);
}

// ---------- selfTest ----------

function selfTest() {
  let pass = 0;
  const total = 11;
  const ok = (cond, label) => { if (cond) { pass++; console.log(`  ok  ${label}`); } else console.log(`  FAIL ${label}`); };

  // parseList
  const list = parseList('# comment\n\nmosco\t/a/b\njidoka (dev)\t/c/d\nbadline-no-tab\n');
  ok(list.length === 2, 'parseList drops comments/blanks/no-tab lines');
  ok(list[0].name === 'mosco' && list[0].path === '/a/b', 'parseList splits name/path on first tab');
  ok(list[1].name === 'jidoka (dev)', 'parseList keeps spaces in name');

  // isReadonly
  ok(isReadonly('castells-calls (backend, read-only!)'), 'isReadonly detects read-only');
  ok(isReadonly('x (readonly)'), 'isReadonly detects readonly (no dash)');
  ok(!isReadonly('mosco (projectx-app)'), 'isReadonly false for normal name');

  // parseGitStatus
  const gs = parseGitStatus('# branch.head dev\n# branch.ab +2 -20\n1 .M ... file.ts\n1 .M ... other.ts\n');
  ok(gs.isGit && gs.branch === 'dev', 'parseGitStatus reads branch');
  ok(gs.ahead === 2 && gs.behind === 20, 'parseGitStatus reads ahead/behind');
  ok(gs.dirty === 2, 'parseGitStatus counts dirty files');

  // level
  ok(level({ isGit: true, dirty: 0, ahead: 0, behind: 0 }, false).dot === '🟢', 'level clean → green');
  ok(level({ isGit: true, dirty: 3, ahead: 0, behind: 0 }, false).dot === '🟡'
    && level({}, true).dot === '🔴', 'level dirty → yellow, halt → red');

  console.log(`[cl-launcher] self-test: ${pass}/${total}`);
  return pass === total ? 0 : 1;
}

// ---------- dispatch ----------

function main() {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  switch (cmd) {
    case 'list': return cmdList();
    case 'preview': return cmdPreview(arg);
    case 'portfolio': return cmdPortfolio();
    case 'guard': return cmdGuard(arg);
    case 'selftest': return process.exit(selfTest());
    default:
      process.stderr.write('usage: cl-launcher.mjs list|preview <path>|portfolio|guard <path>|selftest\n');
      process.exit(2);
  }
}

main();
