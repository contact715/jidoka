#!/usr/bin/env node
// economics.mjs — деньги/токены + «вопрос сессии» для панели jidoka top.
//
// ЧЕСТНОСТЬ: токены берутся ТОЧНО из usage-блоков транскрипта (как cc-stats —
// «no fabricated dollars»). Доллары — ОЦЕНКА по опубликованному прайсу RATES ниже;
// в интерфейсе помечаются «≈». Прайс — список-цены Anthropic, обновлять при их смене.
//
// Архитектура: ЧИСТЫЕ примитивы (foldUsage/costOf/fmtUsd/sparkline/lastAssistantText)
// + тонкие io-обёртки (findTranscript/readSessionEconomics), которые читают
// ~/.claude/projects/<...>/<sessionId>.jsonl с кэшем по (mtime,size) — чтобы
// поллинг панели раз в секунду не перечитывал гигабайты. io никогда не бросает:
// при любой ошибке возвращает null, панель из-за экономики не падает.

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fmtTok, modelFamily } from '../cc-stats.mjs';

export { fmtTok };

// ── прайс, USD за 1 токен (Anthropic, семейства opus/sonnet/haiku 4.x) ──────────
// inp=ввод, out=вывод, cr=чтение кэша, cw=запись кэша (5m). Неизвестная модель → sonnet.
export const RATES = {
  opus:   { inp: 15e-6, out: 75e-6, cr: 1.5e-6, cw: 18.75e-6 },
  sonnet: { inp: 3e-6,  out: 15e-6, cr: 0.3e-6, cw: 3.75e-6 },
  haiku:  { inp: 1e-6,  out: 5e-6,  cr: 0.1e-6, cw: 1.25e-6 },
};
const rateFor = (fam) => RATES[fam] || RATES.sonnet;

// pure: пустой агрегат расхода одной сессии.
export function newUsage() { return { inp: 0, out: 0, cr: 0, cw: 0, byFam: {} }; }

// pure: добавить один usage-блок (под семейство модели) в агрегат. Мутирует и возвращает agg.
export function foldUsage(agg, model, usage = {}) {
  const fam = modelFamily(model);
  const inp = usage.input_tokens || 0, out = usage.output_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0, cw = usage.cache_creation_input_tokens || 0;
  agg.inp += inp; agg.out += out; agg.cr += cr; agg.cw += cw;
  const f = agg.byFam[fam] || (agg.byFam[fam] = { inp: 0, out: 0, cr: 0, cw: 0 });
  f.inp += inp; f.out += out; f.cr += cr; f.cw += cw;
  return agg;
}

// pure: оценка стоимости агрегата в долларах по прайсу (на семейство — свой тариф).
export function costOf(agg) {
  let usd = 0;
  for (const [fam, f] of Object.entries(agg.byFam || {})) {
    const r = rateFor(fam);
    usd += f.inp * r.inp + f.out * r.out + f.cr * r.cr + f.cw * r.cw;
  }
  return usd;
}

// pure: «рабочие» токены сессии = ввод + вывод (без кэша, чтобы число не раздувалось чтением кэша).
export function workTok(agg) { return (agg.inp || 0) + (agg.out || 0); }

// pure: компактные деньги. <$0.01 → «<$0.01»; <$10 → два знака; иначе целые.
export function fmtUsd(n) {
  if (!(n > 0)) return '$0';
  if (n < 0.01) return '<$0.01';
  if (n < 10) return '$' + n.toFixed(2);
  if (n < 1000) return '$' + Math.round(n);
  return '$' + (n / 1000).toFixed(1) + 'k';
}

// pure: юникод-спарклайн из ряда значений. Пустой/нулевой ряд → ровная линия.
const SPARK = '▁▂▃▄▅▆▇█';
export function sparkline(vals, width = 0) {
  let v = (vals || []).map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  if (width > 0) v = v.slice(-width);
  if (!v.length) return '';
  const max = Math.max(...v);
  if (max <= 0) return SPARK[0].repeat(v.length);
  return v.map((x) => SPARK[Math.min(SPARK.length - 1, Math.round((x / max) * (SPARK.length - 1)))]).join('');
}

// pure: последний осмысленный текст ассистента из распарсенных записей транскрипта —
// это «что сессия сейчас спрашивает/говорит». Предпочитает вопрос AskUserQuestion (tool_use),
// иначе последний текстовый блок. Возвращает строку (одна линия) или null.
export function lastAssistantText(records) {
  let text = null, question = null;
  for (const d of records || []) {
    if (!d || d.type !== 'assistant') continue;
    const content = d.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) text = c.text.trim();
      if (c.type === 'tool_use' && c.name === 'AskUserQuestion') {
        const q = c.input?.questions?.[0]?.question;
        if (typeof q === 'string' && q.trim()) question = q.trim();
      }
    }
  }
  const out = question || text;
  return out ? out.replace(/\s+/g, ' ').trim() : null;
}

// ── io (impure, cached) ────────────────────────────────────────────────────────
const PROJECTS = join(homedir(), '.claude', 'projects');
const _txCache = new Map();   // sessionId → transcript path (path не меняется)
const _ecoCache = new Map();  // sessionId → { mtime, size, result }
const MAX_BYTES = 64 * 1024 * 1024; // не парсим транскрипты крупнее 64МБ (защита от лага)

// io: путь к транскрипту сессии. Сканирует подпапки projects, кэширует найденный путь.
export function findTranscript(sessionId, root = PROJECTS) {
  if (!sessionId) return null;
  const cached = _txCache.get(sessionId);
  if (cached && existsSync(cached)) return cached;
  try {
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = join(root, d.name, `${sessionId}.jsonl`);
      if (existsSync(p)) { _txCache.set(sessionId, p); return p; }
    }
  } catch { /* projects недоступна */ }
  return null;
}

// io: расход + вопрос сессии. Кэш по (mtime,size): перечитывает только если файл изменился.
// Любая ошибка → null (панель не падает). { inp,out,cr,cw, usd, workTok, question, model } | null.
export function readSessionEconomics(sessionId, root = PROJECTS) {
  try {
    const path = findTranscript(sessionId, root);
    if (!path) return null;
    const st = statSync(path);
    const hit = _ecoCache.get(sessionId);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.result;
    if (st.size > MAX_BYTES) return null;
    const agg = newUsage();
    const records = [];
    let topModel = null;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      if (d.type === 'assistant') {
        records.push(d);
        const u = d.message?.usage;
        if (u) { foldUsage(agg, d.message?.model, u); if (!topModel) topModel = modelFamily(d.message?.model); }
      }
    }
    const result = {
      inp: agg.inp, out: agg.out, cr: agg.cr, cw: agg.cw,
      usd: costOf(agg), workTok: workTok(agg), model: topModel,
      question: lastAssistantText(records),
    };
    _ecoCache.set(sessionId, { mtime: st.mtimeMs, size: st.size, result });
    return result;
  } catch { return null; }
}

// pure: сводка по флоту для строки здоровья (Г). counts + общий $ + ряд расходов для спарклайна.
export function fleetSummary(sessions) {
  const s = sessions || [];
  const by = (st) => s.filter((x) => x.state === st).length;
  let usd = 0; const costs = [];
  for (const x of s) { const c = x.cost?.usd || 0; usd += c; costs.push(c); }
  return { total: s.length, working: by('working'), waiting: by('waiting'), done: by('done'), usd, costs };
}

// ── self-test ──────────────────────────────────────────────────────────────────
async function selfTest() {
  const fails = []; const ok = (n, c, d = '') => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}${d ? `  (${d})` : ''}`); };

  // foldUsage + costOf: opus 1M out @ $75/M = $75; 1M inp @ $15/M = $15 → $90
  const a = foldUsage(newUsage(), 'claude-opus-4-8', { input_tokens: 1e6, output_tokens: 1e6 });
  ok('fold: tokens summed', a.inp === 1e6 && a.out === 1e6);
  ok('fold: family bucket', a.byFam.opus && a.byFam.opus.out === 1e6);
  ok('cost: opus 1M in + 1M out ≈ $90', Math.abs(costOf(a) - 90) < 1e-6, `${costOf(a)}`);
  const sn = foldUsage(newUsage(), 'claude-sonnet-4-6', { input_tokens: 1e6, output_tokens: 1e6 });
  ok('cost: sonnet cheaper than opus', costOf(sn) < costOf(a), `${costOf(sn)} < ${costOf(a)}`);
  const ca = foldUsage(newUsage(), 'claude-opus-4-8', { cache_read_input_tokens: 1e6 });
  ok('cost: cache-read billed at cr rate', Math.abs(costOf(ca) - 1.5) < 1e-6, `${costOf(ca)}`);
  ok('workTok: in+out, no cache', workTok(foldUsage(newUsage(), 'x', { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 999 })) === 12);

  // fmtUsd
  ok('fmtUsd: <0.01', fmtUsd(0.004) === '<$0.01');
  ok('fmtUsd: cents', fmtUsd(2.4) === '$2.40');
  ok('fmtUsd: dollars', fmtUsd(42.7) === '$43');
  ok('fmtUsd: k', fmtUsd(2500) === '$2.5k');
  ok('fmtUsd: zero', fmtUsd(0) === '$0');

  // sparkline
  ok('sparkline: empty → ""', sparkline([]) === '');
  ok('sparkline: rising last char is full', sparkline([1, 2, 3, 9]).endsWith('█'));
  ok('sparkline: width clips to last N', sparkline([1, 2, 3, 4, 5], 2).length === 2);
  ok('sparkline: all-zero → flat low', sparkline([0, 0, 0]) === '▁▁▁');

  // lastAssistantText: prefers AskUserQuestion, else last text
  const recs = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'старый текст' }] } },
    { type: 'user', message: { content: [] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'свежий текст' }] } },
  ];
  ok('question: last text wins', lastAssistantText(recs) === 'свежий текст');
  const recsQ = [...recs, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: 'Введи код из Telegram?' }] } }] } }];
  ok('question: AskUserQuestion preferred', lastAssistantText(recsQ) === 'Введи код из Telegram?');
  ok('question: empty records → null', lastAssistantText([]) === null);
  ok('question: collapses whitespace', lastAssistantText([{ type: 'assistant', message: { content: [{ type: 'text', text: 'строка\n   с   пробелами' }] } }]) === 'строка с пробелами');

  // io graceful degradation + real read from a temp transcript
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'eco-'));
  try {
    ok('io: missing session → null', readSessionEconomics('nope-nope', root) === null);
    const sub = join(root, '-proj'); mkdirSync(sub);
    const sid = 'aaaa-bbbb';
    const lines = [
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 200 }, content: [{ type: 'text', text: 'делаю' }] } }),
      JSON.stringify({ type: 'user', message: { content: [] } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { output_tokens: 50 }, content: [{ type: 'text', text: 'нужен код' }] } }),
    ].join('\n');
    writeFileSync(join(sub, `${sid}.jsonl`), lines);
    const eco = readSessionEconomics(sid, root);
    ok('io: real read tokens', eco && eco.out === 250 && eco.inp === 100, JSON.stringify(eco));
    ok('io: real read usd > 0', eco && eco.usd > 0);
    ok('io: question from transcript', eco && eco.question === 'нужен код');
    const eco2 = readSessionEconomics(sid, root);
    ok('io: second read served from cache (same object)', eco2 === eco);
  } finally { rmSync(root, { recursive: true, force: true }); }

  // fleetSummary
  const fs = fleetSummary([
    { state: 'working', cost: { usd: 1 } },
    { state: 'waiting', cost: { usd: 2 } },
    { state: 'done', cost: { usd: 0.5 } },
  ]);
  ok('fleet: counts', fs.working === 1 && fs.waiting === 1 && fs.done === 1 && fs.total === 3);
  ok('fleet: total usd summed', Math.abs(fs.usd - 3.5) < 1e-9);
  ok('fleet: costs row for sparkline', Array.isArray(fs.costs) && fs.costs.length === 3);

  // purity: pure section has no fs
  const { readFileSync: rfs } = await import('node:fs');
  const src = rfs(new URL(import.meta.url).pathname, 'utf8');
  const ioStart = src.indexOf('// ── io (impure');
  const pureCode = src.slice(0, ioStart).split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('import')).join('\n');
  // call-form (with paren) — the `import { readFileSync }` line names them but never calls them.
  ok('pure: no fs calls in pure section', !pureCode.includes('readFileSync(') && !pureCode.includes('statSync(') && !pureCode.includes('readdirSync('));

  if (fails.length) { console.log(`\n\x1b[31mFAIL (${fails.length}): ${fails.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ economics: fold/cost/usd/sparkline/question/io correct\x1b[0m'); process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--self-test')) selfTest();
