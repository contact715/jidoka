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
 * @divergence: "без-источника/второй-корень-не-теряется" — скилл стоит ТОЛЬКО во втором
 *              корне (~/.claude/skills), первый существует; старая версия обрывала поиск
 *              на первом корне и такой скилл не появлялся вообще нигде в отчёте — не
 *              «устарел», не «без источника», просто отсутствовал. Отчёт выглядел чистым.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();

/** Где лежат локальные скиллы; берётся первый существующий вариант. */
const SKILL_ROOTS = [
  path.join(HOME, '.agents', 'skills'),
  path.join(HOME, '.claude', 'skills'),
];

/** Реестр сторонних скиллов: единственное место, где записано, откуда что взято. */
const SKILL_LOCK = path.join(HOME, '.agents', '.skill-lock.json');

/**
 * Официальные источники: один репозиторий, единицы = подпапки внутри известного префикса.
 * Сторонние скиллы устроены иначе (у каждого свой репозиторий и своя раскладка), они
 * разбираются отдельно, через lock-файл.
 */
const SOURCES = [
  {
    id: 'skills',
    label: 'Скиллы Anthropic',
    repo: 'anthropics/skills',
    branch: 'main',
    upstreamPrefix: 'skills',
    localRoots: SKILL_ROOTS,
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

/* ------------------------- сторонние скиллы (lock) ------------------------- */

/**
 * Разбирает реестр сторонних скиллов. Формат записи:
 *   "имя": { source: "владелец/репо", skillPath: "путь/до/SKILL.md", ... }
 * Возвращает плоский список; порядок стабильный, чтобы отчёт не прыгал.
 */
export function readSkillLock(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return []; }
  const skills = data && typeof data === 'object' ? data.skills : null;
  if (!skills || typeof skills !== 'object') return [];
  return Object.entries(skills)
    .filter(([, v]) => v && typeof v.source === 'string' && v.source.includes('/'))
    .map(([name, v]) => ({ name, repo: v.source, skillPath: typeof v.skillPath === 'string' ? v.skillPath : 'SKILL.md' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Папка скилла внутри репозитория. Пустая строка = скилл лежит в корне. */
export function folderOf(skillPath) {
  const parts = String(skillPath).split('/');
  parts.pop();
  return parts.join('/');
}

/**
 * Достаёт из дерева репозитория карту { путь относительно папки скилла -> sha }.
 * Пустая карта означает, что папки в источнике больше нет: скилл удалили или
 * переименовали, и это ОТДЕЛЬНЫЙ вердикт, не «устарел».
 */
export function upstreamMapForFolder(treeEntries, folder) {
  const prefix = folder ? `${folder}/` : '';
  const out = new Map();
  for (const e of treeEntries) {
    if (e.type !== 'blob') continue;
    if (!e.path.startsWith(prefix)) continue;
    const rel = e.path.slice(prefix.length);
    // в корне репозитория берём только сам SKILL.md и то, что рядом, без подпапок
    if (!rel || isIgnored(rel)) continue;
    if (!folder && rel.includes('/')) continue;
    out.set(rel, e.sha);
  }
  return out;
}

/** Локальные скиллы, которых нет ни в одном известном источнике. */
export function unsourcedSkills(localNames, lockEntries, officialNames) {
  const known = new Set([...lockEntries.map((e) => e.name), ...officialNames]);
  return localNames.filter((n) => !known.has(n)).sort();
}

/**
 * Объединение имён скиллов по ВСЕМ корням, не только по первому существующему.
 *
 * РАСХОЖДЕНИЕ, которое это закрывает: скилл может стоять ТОЛЬКО во втором корне
 * (у graphify свой установщик, он пишет прямо в ~/.claude/skills и никогда не
 * создаёт запись в ~/.agents/skills). Версия, которая брала список из первого
 * существующего корня и на этом останавливалась, не находила такой скилл НИГДЕ —
 * не в «устарел», не в «без источника», а вообще нигде в отчёте. Отчёт при этом
 * не падал и не жаловался: измеряемая величина («сколько скиллов без источника»)
 * выглядела чистой цифрой, а правило («любая установленная копия чужого кода
 * должна быть хотя бы НАЗВАНА») было нарушено молча. `listDir` принимает
 * готовую реализацию (по умолчанию — чтение файловой системы), чтобы функцию
 * можно было проверить на выдуманных корнях, не трогая диск.
 */
export function collectSkillNames(roots, listDir = defaultListDir) {
  const all = new Set();
  for (const root of roots) {
    for (const name of listDir(root)) all.add(name);
  }
  return [...all];
}

function defaultListDir(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => { try { return fs.statSync(path.join(root, d.name)).isDirectory(); } catch { return false; } })
      .map((d) => d.name);
  } catch {
    return [];
  }
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

/**
 * Дерево репозитория с запасной веткой: у сторонних репозиториев главная ветка
 * называется то main, то master, и жёсткое "main" молча выдавало бы «источник
 * недоступен» там, где он прекрасно доступен.
 */
async function fetchTreeAnyBranch(repo, branches = ['main', 'master']) {
  let last = { ok: false, reason: 'не пробовали' };
  for (const br of branches) {
    last = await fetchTree(repo, br);
    if (last.ok) return last;
    // не-404 (лимит, сеть, таймаут) — это не «нет такой ветки», пробовать вторую бессмысленно
    if (!/HTTP 404/.test(last.reason)) return last;
  }
  return last;
}

/** Один запрос на репозиторий, сколько бы скиллов из него ни стояло. */
function repoTreeCache(fetcher = fetchTreeAnyBranch) {
  const cache = new Map();
  return (repo) => {
    if (!cache.has(repo)) cache.set(repo, fetcher(repo));
    return cache.get(repo);
  };
}

async function checkThirdParty(lockPath = SKILL_LOCK, roots = SKILL_ROOTS) {
  let raw = '';
  try { raw = fs.readFileSync(lockPath, 'utf8'); } catch {
    return { id: 'third-party', label: 'Сторонние скиллы', repo: null, checked: false,
      reason: `нет реестра ${lockPath}, сверять не с чем`, units: [] };
  }
  const entries = readSkillLock(raw);
  if (!entries.length) {
    return { id: 'third-party', label: 'Сторонние скиллы', repo: null, checked: false,
      reason: 'реестр пуст или не разобран', units: [] };
  }
  const getTree = repoTreeCache();
  const units = await Promise.all(entries.map(async (e) => {
    const dir = resolveLocalDir(e.name, roots);
    if (!dir) return { name: e.name, repo: e.repo, dir: null, verdict: 'не установлен', changed: [], missing: [], extra: [] };
    const res = await getTree(e.repo);
    if (!res.ok) {
      return { name: e.name, repo: e.repo, dir, verdict: 'источник недоступен', reason: res.reason, changed: [], missing: [], extra: [] };
    }
    const upstream = upstreamMapForFolder(res.tree, folderOf(e.skillPath));
    if (upstream.size === 0) {
      return { name: e.name, repo: e.repo, dir, verdict: 'путь исчез в источнике', changed: [], missing: [], extra: [] };
    }
    const cmp = compareUnit(upstream, readLocalUnit(dir), e.name);
    return { name: e.name, repo: e.repo, dir, upstreamFiles: upstream.size, ...cmp };
  }));
  return { id: 'third-party', label: 'Сторонние скиллы', repo: null, checked: true, units };
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

const EMPTY_TALLY = () => ({ fresh: 0, stale: 0, absent: 0, builtin: 0, sourceGone: 0, pathGone: 0 });

function tallyUnits(units, into) {
  for (const u of units) {
    if (u.verdict === 'актуален') into.fresh += 1;
    else if (u.verdict === 'устарел') into.stale += 1;
    else if (u.verdict === 'встроен в Claude Code') into.builtin += 1;
    else if (u.verdict === 'источник недоступен') into.sourceGone += 1;
    else if (u.verdict === 'путь исчез в источнике') into.pathGone += 1;
    else into.absent += 1;
  }
  return into;
}

export function summarize(sources, unsourced = 0) {
  const official = EMPTY_TALLY();
  const third = EMPTY_TALLY();
  let unchecked = 0;
  for (const s of sources) {
    if (!s.checked) { unchecked += 1; continue; }
    tallyUnits(s.units, s.kind === 'third-party' ? third : official);
  }
  const total = EMPTY_TALLY();
  for (const k of Object.keys(total)) total[k] = official[k] + third[k];
  return { ...total, unchecked, official, third, unsourced };
}

export function briefLine(sources, unsourced = 0) {
  const s = summarize(sources, unsourced);
  if (sources.length && s.unchecked === sources.length) {
    return 'скиллы: проверить не удалось (нет сети или лимит GitHub)';
  }
  const parts = [];
  // Частичное покрытие НИКОГДА не выдаётся за полное: «все актуальны» при
  // недоступном источнике читается как «всё проверено», и настоящая пропажа
  // проходит незамеченной. Поэтому неполнота идёт первой, а не в хвосте.
  if (s.unchecked) parts.push(`⚠ проверено частично, источников недоступно: ${s.unchecked}`);

  const off = s.official;
  parts.push(off.stale ? `официальные ⚠ устарели: ${off.stale}` : `официальные: все актуальны (${off.fresh})`);

  const th = s.third;
  if (th.fresh + th.stale + th.sourceGone + th.pathGone + th.absent > 0) {
    const bits = [th.stale ? `отстали: ${th.stale}` : `все актуальны (${th.fresh})`];
    if (th.sourceGone) bits.push(`источник пропал: ${th.sourceGone}`);
    if (th.pathGone) bits.push(`удалены в источнике: ${th.pathGone}`);
    parts.push(`сторонние ${bits.join(', ')}`);
  }
  // Скиллы без известного источника — это не «всё хорошо», это непроверяемая зона.
  if (s.unsourced) parts.push(`без источника (сверить не с чем): ${s.unsourced}`);
  return `скиллы — ${parts.join(' · ')}`;
}

function render(sources, unsourced = [], full = false) {
  const lines = [];
  for (const s of sources) {
    lines.push(s.repo ? `${s.label}  (${s.repo})` : s.label);
    if (!s.checked) {
      lines.push(`  не проверено: ${s.reason}`);
      lines.push('');
      continue;
    }
    const by = (v) => s.units.filter((u) => u.verdict === v);
    const stale = by('устарел');
    // Сторонних отставших много, и чинятся они не за один вечер, поэтому по умолчанию
    // печатается первая часть. Число при этом видно всегда: усечение НАЗВАНО, а не
    // сделано молча, иначе отчёт читался бы как полное покрытие.
    const limit = s.kind === 'third-party' && !full ? 8 : stale.length;
    const shown = stale.slice(0, limit);
    for (const u of shown) {
      const d = [];
      if (u.changed.length) d.push(`изменено ${u.changed.length}`);
      if (u.missing.length) d.push(`не хватает ${u.missing.length}`);
      if (u.extra.length) d.push(`лишних ${u.extra.length}`);
      lines.push(`  ОТСТАЛ  ${u.name}  (${d.join(', ')})${u.repo ? `  ← ${u.repo}` : ''}`);
      if (s.kind !== 'third-party') {
        for (const f of [...u.changed, ...u.missing].slice(0, 3)) lines.push(`             ${f}`);
      }
    }
    if (shown.length < stale.length) {
      lines.push(`  … и ещё ${stale.length - shown.length} отставших (весь список: --full или --json)`);
    }
    for (const u of by('источник недоступен')) lines.push(`  источник недоступен  ${u.name}  ← ${u.repo} (${u.reason})`);
    for (const u of by('путь исчез в источнике')) lines.push(`  удалён в источнике  ${u.name}  ← ${u.repo}`);
    for (const u of by('не установлен')) lines.push(`  не установлен  ${u.name}`);
    const builtin = by('встроен в Claude Code');
    const tail = builtin.length ? `, встроены в Claude Code: ${builtin.length}` : '';
    lines.push(`  актуальны: ${by('актуален').length}${tail}`);
    lines.push('');
  }
  if (unsourced.length) {
    lines.push(`Скиллы без известного источника: ${unsourced.length}`);
    lines.push('  Их нет в реестре ~/.agents/.skill-lock.json, поэтому сверять не с чем.');
    const head = full ? unsourced : unsourced.slice(0, 10);
    lines.push(`  ${head.join(', ')}${!full && unsourced.length > head.length ? ` … и ещё ${unsourced.length - head.length}` : ''}`);
    lines.push('');
  }
  lines.push(briefLine(sources, unsourced.length));
  if (summarize(sources).stale) {
    lines.push('');
    lines.push('Что делать: `--json` даёт полный список с путями до каждой папки,');
    lines.push('после чего отставшую папку подтянуть из её репозитория.');
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
  const sum = summarize(fakeSources);
  eq('итог/счётчики', [sum.fresh, sum.stale, sum.absent, sum.builtin, sum.unchecked], [1, 1, 1, 1, 1]);
  eq('итог/встроенный-не-в-пропажах', briefLine(fakeSources).includes('не установлено'), false);

  // Главное свойство строки: частичная проверка не выдаётся за полную.
  const partial = [
    { checked: true, units: [{ verdict: 'актуален' }, { verdict: 'актуален' }] },
    { checked: false, reason: 'нет сети', units: [] },
  ];
  eq('дайджест/частичное-не-врёт', briefLine(partial).includes('все актуальны ('), true);
  eq('дайджест/частичное-названо', briefLine(partial).includes('проверено частично'), true);
  const full = [{ checked: true, units: [{ verdict: 'актуален' }] }];
  eq('дайджест/полное-без-предупреждения', briefLine(full).includes('⚠'), false);
  // Устаревшее обязано попасть в строку.
  const staleOnly = [{ checked: true, units: [{ verdict: 'устарел' }, { verdict: 'актуален' }] }];
  eq('дайджест/устарело-названо', briefLine(staleOnly).includes('официальные ⚠ устарели: 1'), true);
  eq(
    'дайджест/всё-непроверено',
    briefLine([{ checked: false, units: [] }]).includes('проверить не удалось'),
    true,
  );

  /* ---- сторонние скиллы ---- */

  const lockRaw = JSON.stringify({
    version: 1,
    skills: {
      beta: { source: 'own/repo', skillPath: 'skills/beta/SKILL.md' },
      alpha: { source: 'own/repo', skillPath: 'SKILL.md' },
      broken: { skillPath: 'x/SKILL.md' },                 // без source — не запись об источнике
      weird: { source: 'нетслеша', skillPath: 'a/SKILL.md' }, // не "владелец/репо"
    },
  });
  const lock = readSkillLock(lockRaw);
  eq('реестр/берёт-только-с-источником', lock.map((e) => e.name), ['alpha', 'beta']);
  eq('реестр/порядок-стабильный', lock[0].name, 'alpha');
  eq('реестр/битый-json-не-роняет', readSkillLock('{не json'), []);
  eq('реестр/нет-раздела-skills', readSkillLock('{"version":1}'), []);

  eq('папка/вложенный-путь', folderOf('skills/beta/SKILL.md'), 'skills/beta');
  eq('папка/корень-репозитория', folderOf('SKILL.md'), '');

  const repoTree = [
    { type: 'blob', path: 'skills/beta/SKILL.md', sha: 'b1' },
    { type: 'blob', path: 'skills/beta/refs/r.md', sha: 'b2' },
    { type: 'blob', path: 'skills/beta/__pycache__/x.pyc', sha: 'junk' },
    { type: 'blob', path: 'SKILL.md', sha: 'a1' },
    { type: 'blob', path: 'README.md', sha: 'a2' },
    { type: 'tree', path: 'skills/beta', sha: 't' },
  ];
  eq('источник/папка-скилла', [...upstreamMapForFolder(repoTree, 'skills/beta').keys()].sort(), ['SKILL.md', 'refs/r.md']);
  eq('источник/мусор-не-считается', upstreamMapForFolder(repoTree, 'skills/beta').has('__pycache__/x.pyc'), false);
  eq('источник/корень-без-подпапок', [...upstreamMapForFolder(repoTree, '').keys()].sort(), ['README.md', 'SKILL.md']);
  eq('источник/папки-нет-пустая-карта', upstreamMapForFolder(repoTree, 'skills/нет').size, 0);

  eq(
    'без-источника/считаются-только-неизвестные',
    unsourcedSkills(['alpha', 'beta', 'docx', 'моё'], lock, ['docx']),
    ['моё'],
  );

  // РАСХОЖДЕНИЕ: старая версия main() брала имена из ПЕРВОГО существующего корня и
  // обрывала цикл — при двух непустых корнях ('root-one' существует всегда) скилл,
  // стоящий только во втором ('graphify' — установлен ТОЛЬКО туда, где свой установщик
  // пишет напрямую), не появлялся в результате вовсе. Проверяем, что итог — это
  // ОБЪЕДИНЕНИЕ имён по всем корням, а не имена только первого.
  const fakeRoots = ['/fake/root-one', '/fake/root-two'];
  const fakeListDir = (root) => (root === '/fake/root-two' ? ['graphify', 'common'] : ['common', 'alpha']);
  eq(
    'без-источника/второй-корень-не-теряется',
    collectSkillNames(fakeRoots, fakeListDir).sort(),
    ['alpha', 'common', 'graphify'],
  );

  const third = [{
    kind: 'third-party', checked: true,
    units: [
      { verdict: 'устарел' }, { verdict: 'актуален' },
      { verdict: 'источник недоступен' }, { verdict: 'путь исчез в источнике' },
    ],
  }];
  const ts = summarize(third);
  eq('сторонние/считаются-отдельно', [ts.third.stale, ts.third.sourceGone, ts.third.pathGone, ts.official.stale], [1, 1, 1, 0]);
  const tline = briefLine(third);
  eq('сторонние/в-строке-дайджеста', tline.includes('сторонние отстали: 1'), true);
  eq('сторонние/пропавший-источник-назван', tline.includes('источник пропал: 1'), true);
  eq('сторонние/удалённые-названы', tline.includes('удалены в источнике: 1'), true);
  eq('сторонние/не-путаются-с-официальными', tline.includes('официальные: все актуальны'), true);
  eq('без-источника/попадает-в-строку', briefLine(third, 174).includes('без источника (сверить не с чем): 174'), true);

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

  const full = argv.includes('--full');
  const officialOnly = argv.includes('--official-only');

  // Официальные источники и сторонние качаются одновременно: последовательно это
  // были бы десятки запросов подряд, и ежедневная рутина растянулась бы на минуту.
  const [official, third] = await Promise.all([
    Promise.all(SOURCES.map((s) => checkSource(s).then((r) => ({ ...r, kind: 'official' })))),
    officialOnly ? Promise.resolve(null) : checkThirdParty().then((r) => ({ ...r, kind: 'third-party' })),
  ]);
  const sources = third ? [...official, third] : official;

  // Скиллы, которых нет ни в официальном наборе, ни в реестре сторонних: сверять не с чем.
  // collectSkillNames читает ОБА корня (см. её описание выше — там же кейс расхождения,
  // который это чинит: замер 2026-09-02, 74 скилла из ~/.claude/skills были невидимы для
  // этой проверки целиком).
  let unsourced = [];
  if (!officialOnly) {
    const officialNames = official.flatMap((s) => s.units.map((u) => u.name));
    let lock = [];
    try { lock = readSkillLock(fs.readFileSync(SKILL_LOCK, 'utf8')); } catch { /* нет реестра */ }
    unsourced = unsourcedSkills(collectSkillNames(SKILL_ROOTS), lock, officialNames);
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ summary: summarize(sources, unsourced.length), sources, unsourced }, null, 2));
  } else if (argv.includes('--brief')) {
    console.log(briefLine(sources, unsourced.length));
  } else {
    console.log(render(sources, unsourced, full));
  }

  // --strict реагирует только на ОФИЦИАЛЬНЫЕ: сторонних отставших много, они чинятся
  // не за один вечер, и ронять на них ежедневную рутину значит приучить её игнорировать.
  const { official: off } = summarize(sources, unsourced.length);
  process.exit(argv.includes('--strict') && off.stale > 0 ? 1 : 0);
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((e) => {
    // fail-open: неожиданная ошибка не должна ломать ежедневную рутину
    console.error(`skills-freshness: не удалось проверить (${e.message})`);
    process.exit(0);
  });
}
