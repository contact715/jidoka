#!/usr/bin/env node
/**
 * skills-diff — показывает, ЧТО именно изменилось в отставших скиллах.
 *
 * skills-freshness.mjs отвечает на вопрос «что отстало». Этот отвечает на
 * «стоит ли обновлять»: по каждому отставшему скиллу собирает настоящий дифф
 * с источником и складывает в один читаемый документ.
 *
 * Зачем отдельный инструмент, а не разовый скрипт: список живой. Обновишь
 * половину — и документ, собранный руками, начнёт врать. Пересобрать одной
 * командой честнее, чем поддерживать вручную.
 *
 * Дешевизна. Для изменённых файлов содержимое из источника нужно (иначе нет
 * диффа), а для НОВЫХ файлов достаточно размера, и он уже лежит в дереве
 * репозитория. Это убирает примерно две трети запросов.
 *
 * Использование:
 *   node scripts/skills-diff.mjs                     # markdown в stdout
 *   node scripts/skills-diff.mjs -o отчёт.md         # в файл
 *   node scripts/skills-diff.mjs --only obra/superpowers
 *   node scripts/skills-diff.mjs --max-diff 200      # строк диффа на файл
 *   node scripts/skills-diff.mjs --self-test
 *
 * Коды возврата: 0 всегда (отчёт, а не гейт), 2 — ошибка аргументов.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  readSkillLock, folderOf, upstreamMapForFolder, readLocalUnit,
  compareUnit, resolveLocalDir, isIgnored,
} from './skills-freshness.mjs';

const HOME = os.homedir();
const SKILL_LOCK = path.join(HOME, '.agents', '.skill-lock.json');
const SKILL_ROOTS = [path.join(HOME, '.agents', 'skills'), path.join(HOME, '.claude', 'skills')];
const CONCURRENCY = 8;

/* --------------------------------- чистое -------------------------------- */

/** Размеры файлов из дерева: для новых файлов этого достаточно, качать не надо. */
export function sizesForFolder(treeEntries, folder) {
  const prefix = folder ? `${folder}/` : '';
  const out = new Map();
  for (const e of treeEntries) {
    if (e.type !== 'blob' || !e.path.startsWith(prefix)) continue;
    const rel = e.path.slice(prefix.length);
    if (!rel || isIgnored(rel)) continue;
    if (!folder && rel.includes('/')) continue;
    out.set(rel, typeof e.size === 'number' ? e.size : null);
  }
  return out;
}

/** Человеческий размер. */
export function humanSize(bytes) {
  if (bytes === null || bytes === undefined) return 'размер неизвестен';
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

/**
 * Обрезает дифф до предела и ЧЕСТНО сообщает об обрезке. Молчаливое усечение
 * читается как «вот и весь дифф», а это уже враньё в документе для человека.
 */
export function capDiff(text, maxLines) {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { text, truncated: 0 };
  return { text: lines.slice(0, maxLines).join('\n'), truncated: lines.length - maxLines };
}

/** Сколько строк добавлено/убрано, по готовому unified-диффу. */
export function diffStat(unified) {
  let added = 0, removed = 0;
  for (const l of unified.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) added += 1;
    else if (l.startsWith('-') && !l.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

/** Двоичный ли файл: дифф по нему бессмыслен, и вставлять его в отчёт нельзя. */
export function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
}

/* -------------------------------- сетевое -------------------------------- */

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null;
  } catch { return null; }
}

const TOKEN = githubToken();
const HEAD = { Accept: 'application/vnd.github+json', 'User-Agent': 'jidoka-skills-diff', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: HEAD, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

async function treeOf(repo) {
  for (const br of ['main', 'master']) {
    const d = await fetchJson(`https://api.github.com/repos/${repo}/git/trees/${br}?recursive=1`);
    if (d && Array.isArray(d.tree) && !d.truncated) return d.tree;
  }
  return null;
}

/** Содержимое блоба по его SHA: работает и для приватных, и не зависит от имени ветки. */
async function blob(repo, sha) {
  const d = await fetchJson(`https://api.github.com/repos/${repo}/git/blobs/${sha}`);
  if (!d || typeof d.content !== 'string') return null;
  try { return Buffer.from(d.content, d.encoding === 'base64' ? 'base64' : 'utf8'); } catch { return null; }
}

async function pooled(items, worker, limit = CONCURRENCY) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i; i += 1;
      out[idx] = await worker(items[idx], idx);
    }
  }));
  return out;
}

/* --------------------------------- дифф ---------------------------------- */

function unifiedDiff(localBuf, upstreamBuf, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skdiff-'));
  try {
    const a = path.join(dir, 'наш'), b = path.join(dir, 'источник');
    fs.writeFileSync(a, localBuf); fs.writeFileSync(b, upstreamBuf);
    try {
      execFileSync('diff', ['-u', '--label', `наш/${label}`, '--label', `источник/${label}`, a, b], { encoding: 'utf8' });
      return '';                       // код 0 = файлы совпали
    } catch (e) {
      if (e.status === 1 && typeof e.stdout === 'string') return e.stdout;  // код 1 = есть различия
      return `(не удалось построить дифф: ${e.message})`;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* -------------------------------- отчёт ---------------------------------- */

function renderSkill(s, maxDiff) {
  const L = [];
  L.push(`### ${s.name}`);
  L.push('');
  L.push(`Источник: \`${s.repo}\` · папка в источнике: \`${s.folder || '(корень)'}\` · у нас: \`${s.dir}\``);
  const bits = [];
  if (s.changed.length) bits.push(`изменено файлов: ${s.changed.length}`);
  if (s.missing.length) bits.push(`новых в источнике: ${s.missing.length}`);
  if (s.extra.length) bits.push(`есть только у нас: ${s.extra.length}`);
  L.push('');
  L.push(bits.join(' · '));
  L.push('');

  if (s.missing.length) {
    L.push('**Файлы, которых у нас нет:**');
    L.push('');
    for (const m of s.missing) L.push(`- \`${m.path}\` — ${humanSize(m.size)}`);
    L.push('');
  }
  if (s.extra.length) {
    L.push('**Есть только у нас (в источнике таких нет):**');
    L.push('');
    for (const x of s.extra) L.push(`- \`${x}\``);
    L.push('');
    L.push('Это может быть наша правка. Перед обновлением стоит посмотреть.');
    L.push('');
  }
  for (const c of s.changed) {
    L.push(`**Изменён \`${c.path}\`** — ${c.note}`);
    L.push('');
    if (c.diff) {
      const { text, truncated } = capDiff(c.diff, maxDiff);
      L.push('```diff');
      L.push(text.replace(/```/g, "'''"));
      L.push('```');
      if (truncated) L.push(`_дифф обрезан, ещё ${truncated} строк — смотреть целиком в источнике_`);
      L.push('');
    }
  }
  return L.join('\n');
}

function renderDoc(skills, meta, maxDiff) {
  const L = [];
  L.push('# Сторонние скиллы, разошедшиеся с источниками');
  L.push('');
  L.push(`Собрано: ${meta.date} · инструмент: \`scripts/skills-diff.mjs\` (пересобрать: \`npm run skills:diff\`)`);
  L.push('');
  L.push(`Разошлось скиллов: **${skills.length}**. Изменённых файлов: ${meta.changed}, новых в источниках: ${meta.missing}, есть только у нас: ${meta.extra}.`);
  L.push('');
  L.push('Дифф читается так: строки со знаком минус это то, что есть у нас, со знаком плюс это то, что в источнике. Плюсы это то, чего мы не получили; минусы это то, что автор у себя удалил, а у нас оно осталось.');
  L.push('');
  if (meta.skipped.length) {
    L.push(`Не удалось собрать дифф по ${meta.skipped.length} файлам (двоичные или недоступны): ${meta.skipped.slice(0, 8).join(', ')}${meta.skipped.length > 8 ? ` и ещё ${meta.skipped.length - 8}` : ''}.`);
    L.push('');
  }

  L.push('## С чего начинать');
  L.push('');
  L.push('**Расхождение бывает в две стороны, и это не одно и то же.** Источник мог что-то');
  L.push('добавить (тогда обновление нам выгодно) или что-то удалить (тогда обновление');
  L.push('СОТРЁТ то, что у нас есть). Столбец «убрано в источнике» именно про второе:');
  L.push('где там большое число, обновляться вслепую нельзя.');
  L.push('');
  L.push('Сортировка идёт только по тому, чего у нас НЕТ. Скиллы, где источник лишь');
  L.push('похудел, наверх не поднимаются: там решать человеку, а не сортировке.');
  L.push('');
  L.push('| скилл | источник | не получено строк | убрано в источнике | новых файлов | наших файлов не в источнике |');
  L.push('|---|---|---:|---:|---:|---:|');
  for (const s of [...skills].sort((a, b) => b.weight - a.weight)) {
    const warn = s.addedLines === 0 && s.missing.length === 0 && s.removedLines > 0 ? ' ⚠' : '';
    L.push(`| ${s.name}${warn} | ${s.repo} | ${s.addedLines} | ${s.removedLines} | ${s.missing.length} | ${s.extra.length} |`);
  }
  L.push('');
  L.push('«Не получено строк» это сумма плюсов в диффах: есть в источнике, нет у нас.');
  L.push('«Убрано в источнике» это сумма минусов: есть у нас, в источнике удалили.');
  L.push('Пометка ⚠ означает, что источник ТОЛЬКО удалял: обновление здесь ничего не принесёт, только отнимет.');
  L.push('«Наших файлов не в источнике» смотреть отдельно: это либо наша правка, либо удалённый автором файл.');
  L.push('');

  L.push('## Оглавление по репозиториям');
  L.push('');
  const byRepo = new Map();
  for (const s of skills) {
    if (!byRepo.has(s.repo)) byRepo.set(s.repo, []);
    byRepo.get(s.repo).push(s);
  }
  for (const [repo, list] of [...byRepo.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`- **${repo}** (${list.length}): ${list.map((s) => s.name).join(', ')}`);
  }
  L.push('');
  L.push('---');
  L.push('');
  for (const [repo, list] of [...byRepo.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`## ${repo}`);
    L.push('');
    for (const s of list) { L.push(renderSkill(s, maxDiff)); L.push('---'); L.push(''); }
  }
  return L.join('\n');
}

/* ------------------------------ самопроверка ----------------------------- */

function selfTest() {
  const checks = [];
  const eq = (n, got, want) => checks.push({ n, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

  const tree = [
    { type: 'blob', path: 'skills/a/SKILL.md', sha: 's1', size: 100 },
    { type: 'blob', path: 'skills/a/refs/x.md', sha: 's2', size: 2048 },
    { type: 'blob', path: 'skills/a/__pycache__/j.pyc', sha: 's3', size: 9 },
    { type: 'blob', path: 'ROOT.md', sha: 's4', size: 5 },
    { type: 'tree', path: 'skills/a', sha: 't' },
  ];
  eq('размеры/по-папке', [...sizesForFolder(tree, 'skills/a').entries()].sort(), [['SKILL.md', 100], ['refs/x.md', 2048]]);
  eq('размеры/корень-без-подпапок', [...sizesForFolder(tree, '').keys()], ['ROOT.md']);

  eq('размер/байты', humanSize(999), '999 Б');
  eq('размер/килобайты', humanSize(2048), '2.0 КБ');
  eq('размер/неизвестен', humanSize(null), 'размер неизвестен');

  const long = Array.from({ length: 10 }, (_, i) => `строка ${i}`).join('\n');
  eq('обрезка/не-трогает-короткое', capDiff(long, 50).truncated, 0);
  const cut = capDiff(long, 4);
  eq('обрезка/режет-и-сообщает', [cut.text.split('\n').length, cut.truncated], [4, 6]);

  eq('статистика/плюсы-и-минусы',
    diffStat('--- a\n+++ b\n@@\n+новая\n+ещё\n-старая\n конт'), { added: 2, removed: 1 });
  eq('статистика/шапка-не-считается', diffStat('--- a\n+++ b'), { added: 0, removed: 0 });

  eq('двоичный/нули-есть', looksBinary(Buffer.from([1, 2, 0, 4])), true);
  eq('двоичный/обычный-текст', looksBinary(Buffer.from('привет, мир')), false);

  // настоящий дифф через системный diff
  const d = unifiedDiff(Buffer.from('раз\nдва\n'), Buffer.from('раз\nдва\nтри\n'), 'SKILL.md');
  eq('дифф/находит-добавленную-строку', d.includes('+три'), true);
  eq('дифф/подписывает-стороны', d.includes('наш/SKILL.md') && d.includes('источник/SKILL.md'), true);
  eq('дифф/одинаковые-дают-пусто', unifiedDiff(Buffer.from('а\n'), Buffer.from('а\n'), 'x'), '');

  // отчёт называет обрезку, а не молчит о ней
  const doc = renderSkill({
    name: 'тест', repo: 'o/r', folder: 'skills/тест', dir: '/tmp/тест',
    changed: [{ path: 'SKILL.md', note: '+9 −0', diff: long }], missing: [], extra: [],
  }, 3);
  eq('отчёт/обрезка-названа', /дифф обрезан, ещё \d+ строк/.test(doc), true);
  eq('отчёт/тройные-кавычки-обезврежены', renderSkill({
    name: 'т', repo: 'o/r', folder: '', dir: '/tmp',
    changed: [{ path: 'a', note: '', diff: 'текст ``` внутри' }], missing: [], extra: [],
  }, 99).includes("''' внутри"), true);

  const bad = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(c.ok ? `  ✓ ${c.n}` : `  ✗ ${c.n}\n      получено: ${JSON.stringify(c.got)}\n      ожидалось: ${JSON.stringify(c.want)}`);
  console.log(`\nсамопроверка: ${checks.length - bad.length}/${checks.length} прошли`);
  return bad.length ? 1 : 0;
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const argOf = (flag, dflt) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const maxDiff = Number(argOf('--max-diff', '120')) || 120;
  const onlyRepo = argOf('--only', null);
  const outFile = argOf('-o', argOf('--out', null));

  const entries = readSkillLock(fs.readFileSync(SKILL_LOCK, 'utf8'))
    .filter((e) => !onlyRepo || e.repo === onlyRepo);

  const trees = new Map();
  await pooled([...new Set(entries.map((e) => e.repo))], async (repo) => { trees.set(repo, await treeOf(repo)); });

  const skipped = [];
  const stale = [];
  for (const e of entries) {
    const dir = resolveLocalDir(e.name, SKILL_ROOTS);
    const tree = trees.get(e.repo);
    if (!dir || !tree) continue;
    const folder = folderOf(e.skillPath);
    const upstream = upstreamMapForFolder(tree, folder);
    if (upstream.size === 0) continue;
    const local = readLocalUnit(dir);
    const cmp = compareUnit(upstream, local, e.name);
    if (cmp.verdict !== 'устарел') continue;
    const sizes = sizesForFolder(tree, folder);
    stale.push({
      name: e.name, repo: e.repo, folder, dir,
      changedPaths: cmp.changed, missingPaths: cmp.missing, extra: cmp.extra,
      upstream, sizes,
    });
  }

  // Содержимое качаем ТОЛЬКО для изменённых: для новых файлов размер уже в дереве.
  const jobs = stale.flatMap((s) => s.changedPaths.map((p) => ({ s, p })));
  const fetched = await pooled(jobs, async ({ s, p }) => blob(s.repo, s.upstream.get(p)));

  const bySkill = new Map(stale.map((s) => [s, []]));
  jobs.forEach(({ s, p }, i) => {
    const up = fetched[i];
    const localPath = path.join(s.dir, p);
    let loc = null;
    try { loc = fs.readFileSync(localPath); } catch { /* исчез, пока считали */ }
    if (!up || !loc) { skipped.push(`${s.name}/${p}`); bySkill.get(s).push({ path: p, note: 'содержимое недоступно', diff: '' }); return; }
    if (looksBinary(up) || looksBinary(loc)) { skipped.push(`${s.name}/${p}`); bySkill.get(s).push({ path: p, note: 'двоичный файл, дифф не показать', diff: '' }); return; }
    const d = unifiedDiff(loc, up, p);
    const { added, removed } = diffStat(d);
    bySkill.get(s).push({ path: p, note: `в источнике +${added} −${removed} строк`, diff: d });
  });

  const skills = stale.map((s) => {
    const changed = bySkill.get(s).sort((a, b) => a.path.localeCompare(b.path));
    const missing = s.missingPaths.map((p) => ({ path: p, size: s.sizes.get(p) ?? null }));
    const stats = changed.map((c) => (c.diff ? diffStat(c.diff) : { added: 0, removed: 0 }));
    const addedLines = stats.reduce((n, x) => n + x.added, 0);
    const removedLines = stats.reduce((n, x) => n + x.removed, 0);
    // Вес сортировки считается ТОЛЬКО по тому, чего у нас нет. Строки, которые автор
    // удалил, наверх не поднимают: там обновление не добавит, а отнимет, и решать это
    // должен человек, а не сортировка.
    const weight = addedLines + missing.length * 25;
    return { name: s.name, repo: s.repo, folder: s.folder, dir: s.dir, changed, missing, extra: s.extra, addedLines, removedLines, weight };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const meta = {
    date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    changed: skills.reduce((n, s) => n + s.changed.length, 0),
    missing: skills.reduce((n, s) => n + s.missing.length, 0),
    extra: skills.reduce((n, s) => n + s.extra.length, 0),
    skipped,
  };
  const doc = renderDoc(skills, meta, maxDiff);
  if (outFile) { fs.writeFileSync(outFile, doc); console.log(`записано: ${outFile} (${doc.split('\n').length} строк, скиллов ${skills.length})`); }
  else console.log(doc);
  process.exit(0);
}

const direct = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
if (direct) main().catch((e) => { console.error(`skills-diff: ${e.message}`); process.exit(0); });
