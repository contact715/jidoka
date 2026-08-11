#!/usr/bin/env node
/**
 * skills-freshness — сверяет установленные ОФИЦИАЛЬНЫЕ скиллы и плагины Anthropic
 * с их источником на GitHub и говорит, какие отстали.
 *
 * Зачем. Существующий `skills-audit.sh` меряет ДРУГОЕ: как часто скилл упоминается
 * в работе (свежий / активный / спящий). Он никогда не заметит, что сам скилл
 * переписали в апстриме, а у нас лежит версия полугодовой давности. Ровно это и
 * случилось 2026-08-11: `frontend-design` вырос с 4440 до 8260 байт (появились
 * калибровка по трём шаблонным «ИИ-образам», работа в два прохода с самокритикой
 * плана и раздел про тексты в интерфейсе), а у нас лежала старая версия. Узнали
 * случайно, из поста в соцсети. Класс: `installed-copy-drifts-from-upstream`.
 *
 * Как считает. Один запрос к GitHub на репозиторий отдаёт дерево с SHA каждого
 * блоба. SHA блоба в git это sha1("blob <длина>\0" + содержимое), то есть его
 * можно посчитать локально и сравнить, НЕ скачивая ни одного файла. Поэтому
 * проверка дешёвая и годится в ежедневную рутину.
 *
 * Использование:
 *   node scripts/skills-freshness.mjs              # таблица + итог
 *   node scripts/skills-freshness.mjs --brief      # одна строка (для дайджеста)
 *   node scripts/skills-freshness.mjs --json       # машиночитаемо
 *   node scripts/skills-freshness.mjs --strict     # код 1, если что-то устарело
 *   node scripts/skills-freshness.mjs --self-test  # самопроверка
 *
 * Коды возврата:
 *   0 — проверено, всё свежее ИЛИ есть устаревшие, но без --strict
 *       ИЛИ проверить не удалось (сеть/лимит) — намеренно fail-open
 *   1 — есть устаревшие И передан --strict
 *   2 — ошибка конфигурации
 *
 * Fail-open осознанно: рутина, которая падает при отсутствии сети, будет мешать
 * каждый раз, когда ноутбук в самолёте, и её отключат. Молчаливого «всё хорошо»
 * при этом не бывает: непроверенное называется непроверенным.
 *
 * @closes-class: installed-copy-drifts-from-upstream
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();

/** Что и откуда сверяем. */
const SOURCES = [
  {
    id: 'skills',
    label: 'Скиллы Anthropic',
    repo: 'anthropics/skills',
    branch: 'main',
    // папка внутри репозитория, каждая подпапка в ней = одна единица
    upstreamPrefix: 'skills',
    // где искать локально; берётся первый существующий вариант
    localRoots: [
      path.join(HOME, '.agents', 'skills'),
      path.join(HOME, '.claude', 'skills'),
    ],
  },
  {
    id: 'plugins',
    label: 'Плагины Anthropic',
    repo: 'anthropics/claude-plugins-official',
    branch: 'main',
    upstreamPrefix: 'plugins',
    localRoots: [
      path.join(HOME, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins'),
    ],
  },
];

/**
 * Единицы, которых законно нет отдельной папкой: они приезжают внутри самого
 * Claude Code. Без этого списка они каждый день висели бы как «не установлен»,
 * шум приучил бы не читать отчёт, и настоящая пропажа потерялась бы среди него.
 *
 * Проверено 2026-08-11: описание встроенного `claude-api` слово в слово совпадает
 * с описанием в anthropics/skills, то есть это тот же скилл, а не тёзка.
 * Если появится сомнение — сверять заново, а не верить этой строке вечно.
 */
const SHIPPED_WITH_CLAUDE_CODE = new Set(['claude-api']);

/** Файлы, которые не считаются содержимым: мусор сборки и системный хлам. */
const IGNORED_SEGMENTS = new Set(['__pycache__', '.git', 'node_modules']);
const IGNORED_NAMES = new Set(['.DS_Store']);

export function isIgnored(relPath) {
  const parts = relPath.split('/');
  if (parts.some((p) => IGNORED_SEGMENTS.has(p))) return true;
  return IGNORED_NAMES.has(parts[parts.length - 1]);
}

/** SHA блоба по правилам git: sha1("blob <длина>\0" + содержимое). */
export function gitBlobSha(buf) {
  const body = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([header, body])).digest('hex');
}

/**
 * Из плоского дерева GitHub делает карту: имя единицы -> { относительный путь -> sha }.
 * Записи вне upstreamPrefix и файлы прямо в корне prefix игнорируются.
 */
export function groupTree(treeEntries, upstreamPrefix) {
  const out = new Map();
  for (const e of treeEntries) {
    if (e.type !== 'blob') continue;
    const parts = e.path.split('/');
    if (parts[0] !== upstreamPrefix) continue;
    if (parts.length < 3) continue; // нужен хотя бы prefix/имя/файл
    const name = parts[1];
    const rel = parts.slice(2).join('/');
    if (isIgnored(rel)) continue;
    if (!out.has(name)) out.set(name, new Map());
    out.get(name).set(rel, e.sha);
  }
  return out;
}

/** Читает локальную папку в карту { относительный путь -> sha блоба }. */
export function readLocalUnit(dir) {
  const out = new Map();
  const walk = (cur, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (isIgnored(rel)) continue;
      const full = path.join(cur, ent.name);
      let st;
      try {
        st = fs.statSync(full); // statSync идёт по симлинку — так и надо
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, rel);
      else if (st.isFile()) {
        try {
          out.set(rel, gitBlobSha(fs.readFileSync(full)));
        } catch {
          /* нечитаемый файл просто не попадает в карту */
        }
      }
    }
  };
  walk(dir, '');
  return out;
}

/** Сравнивает апстрим и локальную карту одной единицы. */
export function compareUnit(upstream, local, name = null) {
  if (local === null) {
    const verdict = SHIPPED_WITH_CLAUDE_CODE.has(name) ? 'встроен в Claude Code' : 'не установлен';
    return { verdict, changed: [], missing: [], extra: [] };
  }
  const changed = [];
  const missing = [];
  for (const [rel, sha] of upstream) {
    if (!local.has(rel)) missing.push(rel);
    else if (local.get(rel) !== sha) changed.push(rel);
  }
  const extra = [...local.keys()].filter((rel) => !upstream.has(rel));
  const verdict = changed.length || missing.length || extra.length ? 'устарел' : 'актуален';
  return { verdict, changed: changed.sort(), missing: missing.sort(), extra: extra.sort() };
}

/** Ищет локальную папку единицы среди корней; идёт по симлинкам. */
export function resolveLocalDir(name, localRoots) {
  for (const root of localRoots) {
    const p = path.join(root, name);
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) return fs.realpathSync(p);
    } catch {
      /* нет — пробуем следующий корень */
    }
  }
  return null;
}

/** Токен GitHub, если он есть: поднимает лимит с 60 до 5000 запросов в час. */
function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const t = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return t || null;
  } catch {
    return null;
  }
}

async function fetchTree(repo, branch, timeoutMs = 20000) {
  const url = `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jidoka-skills-freshness',
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const hint =
        res.status === 403 || res.status === 429
          ? 'лимит запросов GitHub исчерпан'
          : `HTTP ${res.status}`;
      return { ok: false, reason: hint };
    }
    const data = await res.json();
    if (!Array.isArray(data.tree)) return { ok: false, reason: 'неожиданный ответ GitHub' };
    if (data.truncated) return { ok: false, reason: 'дерево обрезано GitHub, сверка была бы неполной' };
    return { ok: true, tree: data.tree };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'таймаут' : `сеть: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function checkSource(src) {
  const res = await fetchTree(src.repo, src.branch);
  if (!res.ok) {
    return { id: src.id, label: src.label, repo: src.repo, checked: false, reason: res.reason, units: [] };
  }
  const grouped = groupTree(res.tree, src.upstreamPrefix);
  const units = [];
  for (const [name, upstream] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dir = resolveLocalDir(name, src.localRoots);
    const local = dir ? readLocalUnit(dir) : null;
    const cmp = compareUnit(upstream, local, name);
    units.push({ name, dir, upstreamFiles: upstream.size, ...cmp });
  }
  return { id: src.id, label: src.label, repo: src.repo, checked: true, units };
}

export function summarize(sources) {
  let fresh = 0, stale = 0, absent = 0, builtin = 0, unchecked = 0;
  for (const s of sources) {
    if (!s.checked) { unchecked += 1; continue; }
    for (const u of s.units) {
      if (u.verdict === 'актуален') fresh += 1;
      else if (u.verdict === 'устарел') stale += 1;
      else if (u.verdict === 'встроен в Claude Code') builtin += 1;
      else absent += 1;
    }
  }
  return { fresh, stale, absent, builtin, unchecked };
}

export function briefLine(sources) {
  const { fresh, stale, absent, unchecked } = summarize(sources);
  if (unchecked === sources.length) {
    return 'официальные скиллы: проверить не удалось (нет сети или лимит GitHub)';
  }
  const bits = [];
  // Частичное покрытие НИКОГДА не выдаётся за полное: «все актуальны» при
  // недоступном источнике читается как «всё проверено», и настоящая пропажа
  // проходит незамеченной. Поэтому неполнота идёт первой, а не в хвосте.
  if (unchecked) {
    bits.push(`⚠ проверено частично, источников недоступно: ${unchecked}`);
    bits.push(stale ? `устарели среди проверенных: ${stale}` : `среди проверенных устаревших нет (${fresh})`);
  } else {
    bits.push(stale ? `⚠ устарели: ${stale}` : 'все актуальны');
    bits.push(`свежих: ${fresh}`);
  }
  if (absent) bits.push(`не установлено: ${absent}`);
  return `официальные скиллы Anthropic — ${bits.join(', ')}`;
}

function render(sources) {
  const lines = [];
  for (const s of sources) {
    lines.push(`${s.label}  (${s.repo})`);
    if (!s.checked) {
      lines.push(`  не проверено: ${s.reason}`);
      lines.push('');
      continue;
    }
    const stale = s.units.filter((u) => u.verdict === 'устарел');
    const absent = s.units.filter((u) => u.verdict === 'не установлен');
    const builtin = s.units.filter((u) => u.verdict === 'встроен в Claude Code');
    const fresh = s.units.filter((u) => u.verdict === 'актуален');
    if (stale.length) {
      for (const u of stale) {
        const d = [];
        if (u.changed.length) d.push(`изменено ${u.changed.length}`);
        if (u.missing.length) d.push(`не хватает ${u.missing.length}`);
        if (u.extra.length) d.push(`лишних ${u.extra.length}`);
        lines.push(`  УСТАРЕЛ  ${u.name}  (${d.join(', ')})`);
        for (const f of [...u.changed, ...u.missing].slice(0, 3)) lines.push(`             ${f}`);
      }
    }
    for (const u of absent) lines.push(`  не установлен  ${u.name}`);
    const tail = builtin.length ? `, встроены в Claude Code: ${builtin.length}` : '';
    lines.push(`  актуальны: ${fresh.length}${tail}`);
    lines.push('');
  }
  lines.push(briefLine(sources));
  const stale = summarize(sources).stale;
  if (stale) {
    lines.push('');
    lines.push('Обновить: node scripts/skills-freshness.mjs --json  покажет список,');
    lines.push('затем подтянуть нужные папки из соответствующего репозитория Anthropic.');
  }
  return lines.join('\n');
}

/* ------------------------------- самопроверка ------------------------------ */

function selfTest() {
  const checks = [];
  const eq = (name, got, want) =>
    checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

  // 1-4. SHA блоба совпадает с тем, что даёт настоящий git (значения сверены
  // командой `git hash-object` 2026-08-11, а не взяты по памяти).
  eq('blob/пустой', gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  eq('blob/hello', gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  eq('blob/what-is-up-doc', gitBlobSha('what is up, doc?'), 'bd9dbf5aae1a3862dd1526723246b20206e5fc37');
  eq('blob/одна-буква', gitBlobSha('A'), '8c7e5a667f1b771847fe88c01c3de34413a1b220');

  // 5. группировка дерева: берём только нужный префикс и только вложенные файлы
  const tree = [
    { type: 'blob', path: 'skills/alpha/SKILL.md', sha: 'a1' },
    { type: 'blob', path: 'skills/alpha/refs/one.md', sha: 'a2' },
    { type: 'blob', path: 'skills/beta/SKILL.md', sha: 'b1' },
    { type: 'blob', path: 'skills/README.md', sha: 'x' },          // файл в корне prefix — мимо
    { type: 'blob', path: 'spec/other/file.md', sha: 'y' },        // чужой префикс — мимо
    { type: 'tree', path: 'skills/alpha', sha: 't' },              // не блоб — мимо
    { type: 'blob', path: 'skills/alpha/__pycache__/x.pyc', sha: 'z' }, // мусор — мимо
  ];
  const g = groupTree(tree, 'skills');
  eq('дерево/единиц', [...g.keys()].sort(), ['alpha', 'beta']);
  eq('дерево/файлов-alpha', [...g.get('alpha').keys()].sort(), ['SKILL.md', 'refs/one.md']);

  // 7. правила игнора
  eq('игнор/pycache', isIgnored('a/__pycache__/b.pyc'), true);
  eq('игнор/DS_Store', isIgnored('a/.DS_Store'), true);
  eq('игнор/обычный', isIgnored('a/SKILL.md'), false);

  // 8-11. сравнение
  const up = new Map([['SKILL.md', 'aaa'], ['refs/x.md', 'bbb']]);
  eq('сравнение/совпадает', compareUnit(up, new Map(up)).verdict, 'актуален');
  const changed = compareUnit(up, new Map([['SKILL.md', 'ЗЗЗ'], ['refs/x.md', 'bbb']]));
  eq('сравнение/изменён-файл', [changed.verdict, changed.changed], ['устарел', ['SKILL.md']]);
  const missing = compareUnit(up, new Map([['SKILL.md', 'aaa']]));
  eq('сравнение/не-хватает', [missing.verdict, missing.missing], ['устарел', ['refs/x.md']]);
  const extra = compareUnit(up, new Map([...up, ['лишний.md', 'ccc']]));
  eq('сравнение/лишний', [extra.verdict, extra.extra], ['устарел', ['лишний.md']]);
  eq('сравнение/не-установлен', compareUnit(up, null).verdict, 'не установлен');
  eq('сравнение/встроенный-не-считается-пропажей', compareUnit(up, null, 'claude-api').verdict, 'встроен в Claude Code');
  eq('сравнение/обычный-остаётся-пропажей', compareUnit(up, null, 'docx').verdict, 'не установлен');

  // 13. чтение настоящей папки с диска даёт те же SHA, что git
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skfresh-'));
  try {
    fs.mkdirSync(path.join(tmp, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'SKILL.md'), 'hello\n');
    fs.writeFileSync(path.join(tmp, 'sub', 'a.txt'), 'A');
    fs.writeFileSync(path.join(tmp, '__pycache__', 'junk.pyc'), 'мусор');
    fs.writeFileSync(path.join(tmp, '.DS_Store'), 'мусор');
    const m = readLocalUnit(tmp);
    eq('диск/только-содержимое', [...m.keys()].sort(), ['SKILL.md', 'sub/a.txt']);
    eq('диск/sha-совпадает', m.get('SKILL.md'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 15. пустая папка не притворяется установленной единицей на пустом апстриме
  eq('сравнение/пустые-обе', compareUnit(new Map(), new Map()).verdict, 'актуален');

  // 16-18. итог и строка для дайджеста
  const fakeSources = [
    {
      checked: true,
      units: [
        { verdict: 'актуален' },
        { verdict: 'устарел' },
        { verdict: 'не установлен' },
        { verdict: 'встроен в Claude Code' },
      ],
    },
    { checked: false, reason: 'нет сети', units: [] },
  ];
  eq('итог/счётчики', summarize(fakeSources), { fresh: 1, stale: 1, absent: 1, builtin: 1, unchecked: 1 });
  eq('итог/встроенный-не-в-пропажах', briefLine(fakeSources).includes('не установлено: 1'), true);

  // Главное свойство строки: частичная проверка не выдаётся за полную.
  const partial = [
    { checked: true, units: [{ verdict: 'актуален' }, { verdict: 'актуален' }] },
    { checked: false, reason: 'нет сети', units: [] },
  ];
  eq('дайджест/частичное-не-врёт', briefLine(partial).includes('все актуальны'), false);
  eq('дайджест/частичное-названо', briefLine(partial).includes('проверено частично'), true);
  const full = [{ checked: true, units: [{ verdict: 'актуален' }] }];
  eq('дайджест/полное-говорит-полное', briefLine(full).includes('все актуальны'), true);
  // Устаревшее обязано попасть в строку в любой ветке формулировки.
  const line = briefLine(fakeSources);
  eq('дайджест/предупреждает', line.includes('⚠') && /устарел[^:]*: 1\b/.test(line), true);
  const staleOnly = [{ checked: true, units: [{ verdict: 'устарел' }, { verdict: 'актуален' }] }];
  eq('дайджест/устарело-при-полной-проверке', briefLine(staleOnly).includes('⚠ устарели: 1'), true);
  eq(
    'дайджест/всё-непроверено',
    briefLine([{ checked: false, units: [] }]).includes('проверить не удалось'),
    true,
  );

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    if (c.ok) console.log(`  ✓ ${c.name}`);
    else console.log(`  ✗ ${c.name}\n      получено: ${JSON.stringify(c.got)}\n      ожидалось: ${JSON.stringify(c.want)}`);
  }
  console.log(`\nсамопроверка: ${checks.length - failed.length}/${checks.length} прошли`);
  return failed.length === 0 ? 0 : 1;
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());

  const sources = [];
  for (const src of SOURCES) sources.push(await checkSource(src));

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ summary: summarize(sources), sources }, null, 2));
  } else if (argv.includes('--brief')) {
    console.log(briefLine(sources));
  } else {
    console.log(render(sources));
  }

  const { stale } = summarize(sources);
  process.exit(argv.includes('--strict') && stale > 0 ? 1 : 0);
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((e) => {
    // fail-open: неожиданная ошибка не должна ломать ежедневную рутину
    console.error(`skills-freshness: не удалось проверить (${e.message})`);
    process.exit(0);
  });
}
