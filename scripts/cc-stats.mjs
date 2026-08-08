#!/usr/bin/env node
// cc-stats — usage analytics dashboard for Claude Code, rendered in the terminal.
//
// Streams ~/.claude/projects/**/*.jsonl transcripts (mtime-filtered), aggregates assistant-message
// token usage by day / project / model, and draws colored bars. Token counts come straight from the
// API usage blocks in the transcripts — no estimates, no fabricated dollars.
//
// Usage:
//   node cc-stats.mjs               # last 14 days
//   node cc-stats.mjs --days 30
//   node cc-stats.mjs --self-test
//
// FULL & self-tested (pure helpers covered; streaming layer is I/O-thin).

import { createReadStream, readdirSync, statSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';

const C = {
  mint:  s => `\x1b[38;5;49m${s}\x1b[0m`,
  cyan:  s => `\x1b[38;5;80m${s}\x1b[0m`,
  yellow:s => `\x1b[38;5;220m${s}\x1b[0m`,
  orange:s => `\x1b[38;5;208m${s}\x1b[0m`,
  blue:  s => `\x1b[38;5;75m${s}\x1b[0m`,
  violet:s => `\x1b[38;5;141m${s}\x1b[0m`,
  dim:   s => `\x1b[38;5;245m${s}\x1b[0m`,
  bold:  s => `\x1b[1m${s}\x1b[0m`,
};

// ---------- pure helpers ----------

// 1234567 → "1.2M", 45600 → "46K", 320 → "320"
export function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

// horizontal bar scaled to max, width chars
export function hbar(value, max, width = 24) {
  if (!max) return '▱'.repeat(width);
  const filled = Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width));
  return '▰'.repeat(Math.min(filled, width)) + '▱'.repeat(Math.max(0, width - filled));
}

// '-Users-mityamit--claude-jidoka' → 'claude-jidoka' (best-effort tail of the encoded path)
export function projName(dir) {
  const parts = dir.split('--').filter(Boolean);
  const tail = parts[parts.length - 1] || dir;
  return tail.replace(/^-Users-[^-]+-?/, '').replace(/^-+|-+$/g, '') || tail;
}

// 'claude-opus-4-8[1m]' → 'opus', 'claude-sonnet-4-6' → 'sonnet'
export function modelFamily(id) {
  const m = /claude-([a-z]+)/.exec(id || '');
  return m ? m[1] : (id || 'other');
}

// fold one usage record into the aggregate (mutates agg, returns it — testable)

// parentuuid-chain (2026-W31-R13) — every transcript line carries `parentUuid`, and nothing in
// the engine has ever read it. Read flat, a session looks like one straight line of turns. It is
// not: rewinding, editing a prompt or re-running a step forks the chain, and the abandoned fork
// stays in the file. So the flat view counts work that was thrown away as if it had shipped.
//
// The chain turns that into a number the dev-system actually cares about: how much of a session
// was ABANDONED. A high abandoned share means the approach kept failing and being restarted,
// which is the signal a token count cannot give — tokens go up either way.

/** Build parent → children from raw transcript rows. Pure. */
export function buildChain(rows = []) {
  const nodes = new Map();
  for (const r of rows) {
    if (!r || !r.uuid) continue;
    nodes.set(r.uuid, { uuid: r.uuid, parent: r.parentUuid || null, type: r.type || null });
  }
  const children = new Map();
  for (const n of nodes.values()) {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n.uuid);
  }
  return { nodes, children };
}

/**
 * The surviving conversation is the path to the LAST node in file order: everything else that
 * hangs off the tree is work that was rewound away. Pure.
 */
export function chainStats(rows = []) {
  const { nodes, children } = buildChain(rows);
  if (nodes.size === 0) return { total: 0, live: 0, abandoned: 0, abandonedPct: 0, forks: 0 };

  // last node that actually exists in the map, walking from the end of the file
  let tail = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i] && rows[i].uuid && nodes.has(rows[i].uuid)) { tail = rows[i].uuid; break; }
  }
  const live = new Set();
  let cur = tail;
  const guard = new Set(); // a malformed file can point a node at itself
  while (cur && nodes.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    live.add(cur);
    cur = nodes.get(cur).parent;
  }
  // a fork is any node with more than one child: the conversation went two ways from there
  let forks = 0;
  for (const kids of children.values()) if (kids.length > 1) forks++;

  const total = nodes.size;
  const abandoned = total - live.size;
  return {
    total,
    live: live.size,
    abandoned,
    abandonedPct: total ? Math.round((abandoned / total) * 1000) / 10 : 0,
    forks,
  };
}

export function fold(agg, { day, project, model, out, inp, cacheRead }) {
  agg.days[day] = agg.days[day] || { out: 0, inp: 0 };
  agg.days[day].out += out; agg.days[day].inp += inp;
  agg.projects[project] = (agg.projects[project] || 0) + out;
  agg.models[model] = (agg.models[model] || 0) + out;
  agg.totalOut += out; agg.totalInp += inp; agg.totalCache += cacheRead; agg.msgs += 1;
  return agg;
}

export function newAgg() {
  return { days: {}, projects: {}, models: {}, totalOut: 0, totalInp: 0, totalCache: 0, msgs: 0, sessions: new Set() };
}

// ---------- streaming aggregation ----------

async function scan(root, sinceMs) {
  const agg = newAgg();
  let files = 0;
  for (const dir of readdirSync(root)) {
    const dpath = join(root, dir);
    let entries; try { entries = readdirSync(dpath); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const fpath = join(dpath, f);
      try { if (statSync(fpath).mtimeMs < sinceMs) continue; } catch { continue; }
      files++;
      const rl = createInterface({ input: createReadStream(fpath), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
        let d; try { d = JSON.parse(line); } catch { continue; }
        const u = d.message?.usage; const ts = d.timestamp;
        if (!u || !ts) continue;
        const day = ts.slice(0, 10);
        if (new Date(ts).getTime() < sinceMs) continue;
        agg.sessions.add(d.sessionId || f);
        fold(agg, {
          day, project: projName(dir), model: modelFamily(d.message?.model),
          out: u.output_tokens || 0, inp: u.input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
        });
      }
    }
  }
  return { agg, files };
}

// ---------- render ----------

function draw(agg, files, days) {
  const W = [];
  W.push('');
  W.push(C.bold(C.mint(`◤ Claude Code — аналитика за ${days} дн. ◢`)) + C.dim(`  (${files} файлов истории)`));
  W.push('');

  // tokens per day
  const dayKeys = Object.keys(agg.days).sort();
  const maxDay = Math.max(...dayKeys.map(k => agg.days[k].out), 1);
  W.push(C.bold('Вывод токенов по дням'));
  for (const k of dayKeys) {
    const v = agg.days[k].out;
    const paint = v === maxDay ? C.mint : v > maxDay * 0.5 ? C.cyan : C.dim;
    W.push(`  ${C.dim(k.slice(5))}  ${paint(hbar(v, maxDay))} ${paint(fmtTok(v))}`);
  }
  W.push('');

  // top projects
  const top = Object.entries(agg.projects).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxP = top[0]?.[1] || 1;
  W.push(C.bold('Топ проектов (по выводу)'));
  for (const [name, v] of top) {
    W.push(`  ${C.violet(name.padEnd(28).slice(0, 28))} ${C.blue(hbar(v, maxP, 16))} ${C.blue(fmtTok(v))}`);
  }
  W.push('');

  // model mix
  const mTotal = Object.values(agg.models).reduce((a, b) => a + b, 0) || 1;
  const mix = Object.entries(agg.models).sort((a, b) => b[1] - a[1])
    .map(([m, v]) => `${C.mint(m)} ${Math.round((v / mTotal) * 100)}%`).join(C.dim(' · '));
  W.push(C.bold('Модели  ') + mix);
  W.push('');

  // totals
  W.push(C.bold('Итого  ') +
    `${C.mint(fmtTok(agg.totalOut))} ${C.dim('вывод')} · ` +
    `${C.cyan(fmtTok(agg.totalInp))} ${C.dim('ввод')} · ` +
    `${C.dim(fmtTok(agg.totalCache) + ' из кэша')} · ` +
    `${C.yellow(String(agg.sessions.size))} ${C.dim('сессий')} · ` +
    `${C.dim(agg.msgs + ' ответов')}`);
  W.push('');
  return W.join('\n');
}

// ---------- self-test ----------

function selfTest() {
  const T = [
    ['fmtTok 1.2M', fmtTok(1234567) === '1.2M'],
    // parentuuid-chain (2026-W31-R13)
    ['прямая цепочка: брошенного нет',
      chainStats([{uuid:'a',parentUuid:null},{uuid:'b',parentUuid:'a'},{uuid:'c',parentUuid:'b'}]).abandoned === 0],
    ['перемотка оставляет брошенную ветку',
      chainStats([{uuid:'a',parentUuid:null},{uuid:'b',parentUuid:'a'},{uuid:'c',parentUuid:'a'}]).abandoned === 1],
    ['развилка считается развилкой',
      chainStats([{uuid:'a',parentUuid:null},{uuid:'b',parentUuid:'a'},{uuid:'c',parentUuid:'a'}]).forks === 1],
    ['доля брошенного считается в процентах',
      chainStats([{uuid:'a',parentUuid:null},{uuid:'b',parentUuid:'a'},{uuid:'c',parentUuid:'a'},{uuid:'d',parentUuid:'c'}]).abandonedPct === 25],
    ['выжившей считается ветка последней строки файла',
      chainStats([{uuid:'a',parentUuid:null},{uuid:'x',parentUuid:'a'},{uuid:'y',parentUuid:'a'}]).live === 2],
    ['пустой вход не делит на ноль', chainStats([]).abandonedPct === 0],
    ['строки без uuid игнорируются', chainStats([{foo:1},{uuid:'a',parentUuid:null}]).total === 1],
    ['самоссылка не зацикливает обход', chainStats([{uuid:'a',parentUuid:'a'}]).total === 1],
    ['fmtTok 46K', fmtTok(45600) === '46K'],
    ['fmtTok plain', fmtTok(320) === '320'],
    ['fmtTok 2.5B', fmtTok(2.5e9) === '2.5B'],
    ['hbar full', hbar(10, 10, 4) === '▰▰▰▰'],
    ['hbar half', hbar(5, 10, 4) === '▰▰▱▱'],
    ['hbar zero-max safe', hbar(0, 0, 3) === '▱▱▱'],
    ['hbar tiny visible', hbar(1, 1000, 10).startsWith('▰')],
    ['projName jidoka', projName('-Users-mityamit--claude-jidoka') === 'claude-jidoka'],
    ['projName plain', projName('-Users-mityamit') === '-Users-mityamit'],
    ['modelFamily opus', modelFamily('claude-opus-4-8[1m]') === 'opus'],
    ['modelFamily sonnet', modelFamily('claude-sonnet-4-6') === 'sonnet'],
    ['fold aggregates', (() => {
      const a = fold(newAgg(), { day: '2026-06-05', project: 'p', model: 'opus', out: 10, inp: 5, cacheRead: 2 });
      fold(a, { day: '2026-06-05', project: 'p', model: 'opus', out: 1, inp: 1, cacheRead: 0 });
      return a.days['2026-06-05'].out === 11 && a.projects.p === 11 && a.models.opus === 11 && a.msgs === 2;
    })()],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mcc-stats self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ cc-stats: helpers correct\x1b[0m');
  process.exit(0);
}

// ---------- main ----------

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  // parentuuid-chain: --rework reads the causal chain instead of the token totals and reports
  // how much of each session was rewound away. Tokens rise whether work shipped or was thrown
  // out; this separates the two.
  if (process.argv.includes('--rework')) {
    const root = join(homedir(), '.claude', 'projects');
    const rows = [];
    let dirs = [];
    try { dirs = readdirSync(root); } catch { /* none */ }
    for (const d of dirs) {
      const p = join(root, d);
      let files = [];
      try { if (!statSync(p).isDirectory()) continue; files = readdirSync(p).filter((x) => x.endsWith('.jsonl')); } catch { continue; }
      for (const x of files) {
        let raw;
        try { raw = readFileSync(join(p, x), 'utf8'); } catch { continue; }
        const parsed = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        // subagent branches hang off the main chain by design and are NOT abandoned work, so
        // they are excluded before measuring: counting them would inflate the number in exactly
        // the sessions that used agents most.
        const st = chainStats(parsed.filter((r) => !r.isSidechain));
        if (st.total >= 50) rows.push({ session: x.slice(0, 8), ...st });
      }
    }
    rows.sort((a, b) => b.abandonedPct - a.abandonedPct);
    const totals = rows.reduce((a, r) => ({ total: a.total + r.total, abandoned: a.abandoned + r.abandoned }), { total: 0, abandoned: 0 });
    console.log('переделка по причинной цепочке (сессии от 50 шагов)');
    console.log('');
    console.log('  сессия     шагов  брошено   доля  развилок');
    for (const r of rows.slice(0, 15)) {
      console.log('  ' + r.session + '  ' + String(r.total).padStart(6) + '  ' + String(r.abandoned).padStart(7) + '  ' + String(r.abandonedPct).padStart(5) + '%  ' + String(r.forks).padStart(8));
    }
    const pct = totals.total ? Math.round((totals.abandoned / totals.total) * 1000) / 10 : 0;
    console.log('');
    console.log('  всего: ' + rows.length + ' сессий, ' + totals.total + ' шагов, брошено ' + totals.abandoned + ' (' + pct + '%)');
    console.log('  брошенное это работа, отменённая перемоткой: токены за неё потрачены, результата нет.');
    process.exit(0);
  }
  const di = process.argv.indexOf('--days');
  const days = di > -1 ? Math.max(1, parseInt(process.argv[di + 1], 10) || 14) : 14;
  const sinceMs = Date.now() - days * 86400000;
  const root = join(homedir(), '.claude', 'projects');
  const t0 = Date.now();
  const { agg, files } = await scan(root, sinceMs);
  process.stdout.write(draw(agg, files, days));
  console.log(C.dim(`  собрано за ${((Date.now() - t0) / 1000).toFixed(1)}с\n`));
}
