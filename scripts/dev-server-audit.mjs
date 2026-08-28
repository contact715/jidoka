#!/usr/bin/env node
/**
 * dev-server-audit — лишние серверы разработки: найти, назвать, убрать.
 *
 * ЗАЧЕМ. 2026-08-27 машина с 18 ГБ памяти встала: подкачка забита на 97%
 * (23,8 ГБ из 24,6), средняя нагрузка 20,5, свободно 280 МБ. Виновником
 * оказались ТРИ сервера разработки Next.js, поднятые тремя параллельными
 * сессиями: 5,8 + 5,2 + 4,0 = 15 ГБ. Два из них слушали разные порты, но
 * работали В ОДНОЙ И ТОЙ ЖЕ рабочей папке — то есть один был чистым дублем.
 *
 * ПОЧЕМУ СОСЕДНИЕ ПРИБОРЫ ЭТОГО НЕ ВИДЯТ, и это не их недоработка.
 * `process-health.mjs` и `mcp-reaper.sh` ловят процесс по признаку СИРОТСТВА
 * (родитель мёртв) или по ВОЗРАСТУ. Здесь оба признака молчали законно:
 * родителями были работающие сессии Claude, а четыре часа для сервера
 * разработки — нормальный возраст. Ось у этого прибора третья:
 * СКОЛЬКО СЕРВЕРОВ ПРИХОДИТСЯ НА ОДНУ РАБОЧУЮ ПАПКУ.
 *
 * ЧТО СЧИТАЕТСЯ ЛИШНИМ. Только дубль: два и более сервера с совпадающей
 * рабочей папкой. Это избыточность по определению — они собирают один и тот
 * же код, и памяти каждый просит одинаково. Лишними считаются все, кроме
 * САМОГО СВЕЖЕГО: старший с большей вероятностью забыт закрывшейся работой,
 * младший — тот, которым пользуются сейчас.
 *
 * ЧЕГО ПРИБОР НЕ ДЕЛАЕТ И ПОЧЕМУ. Он никогда не убивает единственный сервер
 * в папке, каким бы старым и толстым тот ни был. Единственный сервер — это
 * чья-то работа, и решение о ней принимает человек, а не порог в скрипте.
 * Прибор его НАЗЫВАЕТ вместе с весом, и на этом останавливается.
 *
 * Без --fix не трогает ничего. Убивает мягко: TERM, пауза, затем KILL
 * выжившим. Убивает вместе с обёрткой-запускателем (`next dev`), иначе та
 * поднимет сервер заново и работа окажется напрасной.
 *
 * РАСХОЖДЕНИЕ ПРОКСИ И ПРАВИЛА — входы, на которых удобный признак говорит
 * «чисто», а правило при этом нарушено. Под каждый заведена проверка:
 *
 * @divergence: "разные порты — всё ещё дубль" — порт различается (3000 и 3031),
 *   поэтому признак «один порт = один сервер» объявляет их независимыми, но
 *   рабочая папка у них одна, значит второй избыточен. Ровно этот случай съел
 *   11 ГБ 2026-08-27.
 * @divergence: "лёгкий корень при тяжёлом роде" — резидентная память корня
 *   1 МБ, признак «вес по ps» говорит «безобидная обёртка», а род весит
 *   3172 МБ: память живёт в потомке и в сжатом виде.
 * @divergence: "ужатый файл подкачки при той же беде" — процент занятой
 *   подкачки упал с 97% до 86% и читается как «почти не помогло», хотя в
 *   подкачке стало на 13,6 ГБ меньше: macOS ужал знаменатель.
 *
 * @closes-class: duplicate-dev-servers-starve-the-machine
 * @scope: all
 * @scope-ok: область — процессы машины, а не файлы репозитория; замер идёт
 *            по одному вызову ps и стоит десятки миллисекунд
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PAGE = 16384;

/** Одна строка ps → запись. Возраст ps приходит как [[дд-]чч:]мм:сс. */
export function etimeToMinutes(t) {
  if (typeof t !== 'string' || !t.trim()) return 0;
  let days = 0, rest = t.trim();
  if (rest.includes('-')) { const [d, r] = rest.split('-'); days = Number(d) || 0; rest = r; }
  const parts = rest.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) [h, m, s] = parts;
  else if (parts.length === 2) [m, s] = parts;
  else return 0;
  return days * 1440 + h * 60 + m + s / 60;
}

/**
 * Сервер разработки ли это ПО ИМЕНИ КОМАНДЫ. Оставлено для самопроверок и
 * как подсказка, но опознание сервера на нём НЕ строится — см. ниже.
 */
export function isDevServer(args) {
  if (typeof args !== 'string') return false;
  if (/\bnext-server\b/.test(args)) return true;
  if (/\bnext\b.*\bdev\b/.test(args)) return true;
  if (/\bvite\b(?!.*\bbuild\b)/.test(args) && /node/.test(args)) return true;
  return false;
}

/**
 * СЕРВЕР ОПОЗНАЁТСЯ ПО СЛУШАЮЩЕМУ ПОРТУ, А НЕ ПО ИМЕНИ КОМАНДЫ.
 *
 * Две попытки опознавать по строке команды провалились подряд, 2026-08-27:
 *   1. наивная — объявила дублями три части ОДНОГО сервера (оболочка,
 *      запускатель `next dev`, сам `next-server`);
 *   2. свёртка дерева — стало лучше, но обёртки `next dev` по 1 МБ всё равно
 *      считались серверами, а вес показывался их собственный: «сервер 1 МБ»
 *      там, где на деле работал полуторагигабайтный процесс. Число, которое
 *      льстит, хуже отсутствующего.
 *
 * Слушающий порт — прямой факт, а не догадка: сервер существует ровно затем,
 * чтобы отвечать на порту. Один порт — один сервер. Вес считается по ВСЕМУ
 * роду от корня, потому что память живёт в потомке, а не в запускателе.
 */
export function attributeWeight(rootPid, all, weights) {
  const kids = new Map();
  for (const p of all) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p);
  }
  let mb = 0, seen = new Set(), stack = [rootPid];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const heavy = weights && weights.get ? weights.get(cur) : undefined;
    const self = all.find((p) => p.pid === cur);
    if (heavy !== undefined) mb += heavy;
    else if (self) mb += self.mb;
    for (const k of kids.get(cur) || []) stack.push(k.pid);
  }
  return { mb, family: [...seen] };
}

/**
 * Поднять слушающий процесс до корня его сервера: вверх, пока родитель
 * ещё похож на часть того же сервера (запускатель, обёртка npm, оболочка
 * сессии). Выше оболочки не идём — там уже чужая сессия Claude.
 */
export function climbToRoot(pid, all) {
  const byPid = new Map(all.map((p) => [p.pid, p]));
  let cur = byPid.get(pid), hops = 0;
  while (cur && hops < 10) {
    const parent = byPid.get(cur.ppid);
    if (!parent) break;
    const partOfServer = isDevServer(parent.args)
      || /\bnpm\b.*\b(run|exec)\b/.test(parent.args)
      || /^\/bin\/(z|ba)?sh -c/.test(parent.args);
    if (!partOfServer) break;
    cur = parent; hops++;
  }
  return cur ? cur.pid : pid;
}

/**
 * Свернуть дерево процессов до КОРНЕЙ. Один сервер разработки — это три-четыре
 * процесса: оболочка, запускатель `next dev`, сам `next-server`. Все они живут
 * в одной рабочей папке, и наивная группировка объявляет их дублями друг друга.
 *
 * Поймано 2026-08-27 на первом же живом прогоне: прибор назвал «дублями» две
 * части единственного работающего сервера и с --fix убил бы чужую работу,
 * отчитавшись об экономии. Ровно та ошибка, от которой предостерегает
 * process-health.mjs: род считается по дереву, а не по отдельной строке ps.
 *
 * Сервером считается только тот, у кого НЕТ предка среди найденных серверов.
 */
export function rootsOnly(servers) {
  const pids = new Set(servers.map((s) => s.pid));
  const byPid = new Map(servers.map((s) => [s.pid, s]));
  return servers.filter((s) => {
    // поднимаемся по цепочке: есть ли выше по роду другой найденный сервер
    let up = s.ppid, hops = 0;
    while (up && up !== 1 && hops < 20) {
      if (pids.has(up)) return false;
      const parent = byPid.get(up);
      if (!parent) break;              // выше нашего списка не видим — считаем корнем
      up = parent.ppid; hops++;
    }
    return true;
  });
}

/**
 * Группировка по рабочей папке. Лишние — все, кроме самого свежего.
 * ВАЖНО: единственный сервер в папке лишним не бывает никогда.
 */
export function findRedundant(servers) {
  const byDir = new Map();
  for (const s of servers) {
    const key = s.cwd || `?${s.pid}`;          // неизвестная папка не склеивается с чужой
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key).push(s);
  }
  const groups = [];
  for (const [dir, list] of byDir) {
    const sorted = [...list].sort((a, b) => a.minutes - b.minutes);  // свежий первым
    groups.push({
      dir,
      keep: sorted[0],
      redundant: sorted.slice(1),
      totalMb: list.reduce((n, s) => n + s.mb, 0),
    });
  }
  return groups.sort((a, b) => b.totalMb - a.totalMb);
}

/**
 * Настоящий вес процесса в мегабайтах.
 *
 * ПОЧЕМУ НЕ `ps -o rss`. На macOS резидентный размер НЕ включает сжатую
 * память, а система сжимает агрессивно. Замер 2026-08-27: сумма RSS по всем
 * процессам дала 6 ГБ на машине, где реально было занято 19 ГБ и подкачка
 * стояла на 97%. Сам этот прибор на первом прогоне отчитался «сервер 111 МБ»
 * про процесс, весивший 3172 МБ — в 28 раз меньше правды.
 *
 * `top -l 1 -stats pid,mem` показывает RSS ПЛЮС сжатое. Один вызов на весь
 * замер. Если top недоступен, откатываемся на RSS и ГОВОРИМ об этом вслух,
 * а не выдаём заниженное за точное.
 */
function realWeights() {
  try {
    const out = execFileSync('top', ['-l', '1', '-o', 'mem', '-stats', 'pid,mem'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    const map = new Map();
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+([\d.]+)([KMG])\+?\s*$/);
      if (!m) continue;
      const n = Number(m[2]);
      const mb = m[3] === 'G' ? n * 1024 : m[3] === 'K' ? n / 1024 : n;
      map.set(+m[1], Math.round(mb));
    }
    return map.size ? { map, exact: true } : { map: new Map(), exact: false };
  } catch { return { map: new Map(), exact: false }; }
}

function ps() {
  const out = execFileSync('ps', ['-Ao', 'pid=,ppid=,rss=,etime=,args='], { encoding: 'utf8', maxBuffer: 8 << 20 });
  return out.split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) return null;
    return { pid: +m[1], ppid: +m[2], mb: Math.round(+m[3] / 1024), minutes: etimeToMinutes(m[4]), args: m[5] };
  }).filter(Boolean);
}

/** Кто слушает TCP-порт. Прямой факт о том, что сервер работает. */
function listeningServers(all) {
  let out = '';
  try {
    out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return []; }
  const found = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\S+\s+(\d+)\s+.*?(\S*:(\d+))\s+\(LISTEN\)/);
    if (!m) continue;
    const pid = +m[1];
    const proc = all.find((p) => p.pid === pid);
    if (!proc) continue;
    if (!/node|next|vite|bun|deno/.test(proc.args)) continue;   // только серверы разработки
    if (found.some((f) => f.pid === pid && f.port === m[3])) continue;
    found.push({ pid, port: m[3], ...proc });
  }
  return found;
}

function cwdOf(pid) {
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    const line = out.split('\n').find((l) => l.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch { return null; }
}

/**
 * Память машины: сколько ушло в подкачку и насколько тяжело дышит.
 *
 * ТРЕВОГА СЧИТАЕТСЯ ПО АБСОЛЮТНОМУ РАЗМЕРУ, А НЕ ПО ПРОЦЕНТУ. Найдено в тот
 * же день, 2026-08-27, сразу после первого прогона: macOS сам растит и
 * ужимает файл подкачки под текущую нужду. До чистки было занято 23,8 ГБ
 * при общем размере 24,6 — это 97%. После чистки система ужала общий размер
 * до 11 ГБ, занято стало 10,2 — и процент показал 86%, то есть «почти так же
 * плохо», хотя в подкачке стало на 13,6 ГБ меньше. Процент от знаменателя,
 * который система двигает сама, измеряет не состояние машины, а решение
 * macOS о размере файла.
 */
function memory() {
  try {
    const vm = execFileSync('vm_stat', { encoding: 'utf8' });
    const num = (re) => { const m = vm.match(re); return m ? Number(m[1].replace(/\./g, '')) : 0; };
    const compressorGb = num(/Pages occupied by compressor:\s+(\d+)/) * PAGE / 1073741824;
    const swap = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8' });
    const sm = swap.match(/used = ([\d.]+)M/);
    const swapUsedGb = sm ? Number(sm[1]) / 1024 : 0;
    const load = execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }).match(/([\d.]+)/);
    const cores = Number(execFileSync('sysctl', ['-n', 'hw.ncpu'], { encoding: 'utf8' }).trim()) || 8;
    return {
      compressorGb: +compressorGb.toFixed(1),
      swapUsedGb: +swapUsedGb.toFixed(1),
      load: load ? Number(load[1]) : 0,
      cores,
    };
  } catch { return null; }
}

/**
 * Насколько тяжело машине СЕЙЧАС. Три состояния, не два.
 *
 * ПОЧЕМУ НЕ ОДИН ПОРОГ ПО ПОДКАЧКЕ. Первая версия кричала «задыхается» при
 * подкачке выше 8 ГБ — и продолжила кричать после уборки, когда нагрузка
 * упала с 20,5 до 5,1 при 12 ядрах, то есть машина уже дышала свободно.
 * Однажды сброшенные в подкачку страницы остаются там и после того, как
 * давление ушло: занятая подкачка говорит о ПРОШЛОМ дефиците, нагрузка — о
 * НАСТОЯЩЕМ. Тревога, которая горит всегда, учит её не замечать; это тот же
 * изъян, что и зелёная галочка, которая ничего не проверяет, только наизнанку.
 *
 *   'задыхается' — подкачка велика И машина реально гребёт (нагрузка выше
 *                  полутора ядер на ядро): дефицит идёт прямо сейчас;
 *   'в подкачке'  — подкачка велика, но нагрузка спокойная: памяти было мало,
 *                   сейчас терпимо. Повод прибраться, не повод бить тревогу;
 *   'спокойно'    — ни того, ни другого.
 */
export function pressureLevel(m) {
  if (!m) return 'спокойно';
  const swapHigh = m.swapUsedGb >= 8;
  const busy = m.load >= m.cores * 1.5;
  if (swapHigh && busy) return 'задыхается';
  if (busy) return 'задыхается';
  if (swapHigh) return 'в подкачке';
  return 'спокойно';
}

/** Оставлено ради обратной совместимости вызовов: тревога это не «спокойно». */
export function isStarving(m) {
  return pressureLevel(m) !== 'спокойно';
}

function pause(ms) { execFileSync('perl', ['-e', `select(undef,undef,undef,${ms / 1000})`]); }

function main(argv) {
  const fix = argv.includes('--fix');
  const all = ps();
  const mePid = process.pid;

  const { map: weights, exact } = realWeights();
  // опознаём по слушающему порту: один порт — один сервер
  const listeners = listeningServers(all);
  const seenRoots = new Map();
  for (const l of listeners) {
    const root = climbToRoot(l.pid, all);
    if (seenRoots.has(root)) { seenRoots.get(root).ports.push(l.port); continue; }
    const { mb } = attributeWeight(root, all, weights);
    const self = all.find((p) => p.pid === root) || l;
    seenRoots.set(root, { pid: root, ppid: self.ppid, minutes: self.minutes, mb, ports: [l.port], cwd: cwdOf(l.pid) });
  }
  const servers = [...seenRoots.values()].filter((s) => s.pid !== mePid);

  const m = memory();
  if (m) {
    const level = pressureLevel(m);
    const tail = level === 'задыхается' ? '  ← машина задыхается ПРЯМО СЕЙЧАС'
      : level === 'в подкачке' ? '  ← дефицит был, сейчас терпимо: повод прибраться'
      : '';
    console.log(`[память] в подкачке ${m.swapUsedGb} ГБ, сжато ${m.compressorGb} ГБ, нагрузка ${m.load} на ${m.cores} ядер${tail}`);
  }

  if (!exact) console.log('[оговорка] top недоступен — вес считается по резидентной памяти и ЗАНИЖЕН: сжатое в него не входит');
  if (!servers.length) { console.log('[серверы] ни одного сервера разработки не запущено'); return 0; }

  const groups = findRedundant(servers);
  const redundant = groups.flatMap((g) => g.redundant);

  for (const g of groups) {
    const short = g.dir.replace(process.env.HOME || '~', '~');
    console.log(`\n[папка] ${short} — серверов ${g.redundant.length + 1}, вместе ${g.totalMb} МБ`);
    console.log(`   оставляю  ${g.keep.pid}  ${g.keep.mb} МБ  порт ${g.keep.ports.join(',')}  ${Math.round(g.keep.minutes)} мин`);
    for (const r of g.redundant) console.log(`   ЛИШНИЙ    ${r.pid}  ${r.mb} МБ  порт ${r.ports.join(',')}  ${Math.round(r.minutes)} мин  ← дубль той же папки`);
  }

  if (!redundant.length) { console.log('\n[итог] дублей нет — каждый сервер в своей папке'); return 0; }
  if (!fix) { console.log(`\n[итог] лишних ${redundant.length}, вместе ${redundant.reduce((n, r) => n + r.mb, 0)} МБ. Убрать: тот же вызов с --fix`); return 0; }

  // вместе с обёрткой-запускателем, иначе она поднимет сервер заново
  // корень уводим вместе со всем его родом, иначе запускатель поднимет сервер заново
  const kill = new Set();
  for (const r of redundant) {
    kill.add(r.pid);
    const stack = [r.pid];
    while (stack.length) {
      const cur = stack.pop();
      for (const p of all) if (p.ppid === cur && !kill.has(p.pid)) { kill.add(p.pid); stack.push(p.pid); }
    }
  }
  const list = [...kill];
  for (const pid of list) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  pause(4000);
  let killed = 0;
  for (const pid of list) {
    try { process.kill(pid, 0); try { process.kill(pid, 'SIGKILL'); } catch {} } catch { killed++; }
  }
  console.log(`\n[итог] остановлено ${killed} из ${list.length}, освобождено около ${redundant.reduce((n, r) => n + r.mb, 0)} МБ`);
  return 0;
}

function selfTest() {
  let ok = 0, bad = 0;
  const t = (name, cond) => { if (cond) { ok++; } else { bad++; console.log(`  ✗ ${name}`); } };

  t('возраст мм:сс', Math.abs(etimeToMinutes('05:30') - 5.5) < 0.01);
  t('возраст чч:мм:сс', Math.abs(etimeToMinutes('02:10:00') - 130) < 0.01);
  t('возраст с днями', Math.abs(etimeToMinutes('1-00:00:00') - 1440) < 0.01);
  t('мусор даёт ноль', etimeToMinutes('чепуха') === 0);
  t('пусто даёт ноль', etimeToMinutes('') === 0 && etimeToMinutes(null) === 0);

  t('next-server опознан', isDevServer('next-server (v16.2.6)'));
  t('next dev опознан', isDevServer('node node_modules/.bin/next dev --webpack -p 3000'));
  t('next build НЕ сервер', !isDevServer('node node_modules/.bin/next build'));
  t('vite build НЕ сервер', !isDevServer('node node_modules/.bin/vite build'));
  t('tsc не сервер', !isDevServer('node node_modules/typescript/bin/tsc --noEmit'));
  t('не строка не падает', !isDevServer(null) && !isDevServer(undefined) && !isDevServer(42));

  const one = findRedundant([{ pid: 1, cwd: '/a', mb: 5000, minutes: 400 }]);
  t('единственный сервер лишним не бывает', one[0].redundant.length === 0);

  // @divergence: "разные порты — всё ещё дубль"
  const diffPorts = findRedundant([
    { pid: 1, cwd: '/a', mb: 5200, minutes: 390, ports: ['3000'] },
    { pid: 2, cwd: '/a', mb: 5800, minutes: 240, ports: ['3031'] },
  ]);
  t('разные порты не оправдывают дубль в одной папке', diffPorts[0].redundant.length === 1);

  // @divergence: "лёгкий корень при тяжёлом роде"
  const lightRoot = [
    { pid: 50, ppid: 1, mb: 1, args: 'next dev' },
    { pid: 51, ppid: 50, mb: 111, args: 'next-server' },
  ];
  t('лёгкий корень не скрывает тяжёлый род',
    attributeWeight(50, lightRoot, new Map([[51, 3172]])).mb === 3173);

  // @divergence: "ужатый файл подкачки при той же беде"
  t('ужатый файл подкачки не маскирует беду',
    pressureLevel({ swapUsedGb: 10.2, load: 3, cores: 12 }) !== 'спокойно');
  t('и не поднимает тревогу там, где её нет',
    pressureLevel({ swapUsedGb: 1.1, load: 3, cores: 12 }) === 'спокойно');
  // @divergence: "полная подкачка при спокойной машине" — признак «в подкачке много»
  //   один говорит «пожар», хотя нагрузка 5 на 12 ядер: страницы остались от ПРОШЛОГО
  //   дефицита. Ровно это состояние машина имела через час после уборки 2026-08-27.
  t('прошлый дефицит не выдаётся за нынешний',
    pressureLevel({ swapUsedGb: 11.5, load: 5.07, cores: 12 }) !== 'задыхается');

  const two = findRedundant([
    { pid: 1, cwd: '/a', mb: 5000, minutes: 400 },
    { pid: 2, cwd: '/a', mb: 4000, minutes: 30 },
  ]);
  t('дубль найден', two[0].redundant.length === 1);
  t('оставлен самый свежий', two[0].keep.pid === 2);
  t('лишним назван старший', two[0].redundant[0].pid === 1);
  t('вес группы сложен', two[0].totalMb === 9000);

  const diff = findRedundant([
    { pid: 1, cwd: '/a', mb: 100, minutes: 10 },
    { pid: 2, cwd: '/b', mb: 100, minutes: 10 },
  ]);
  t('разные папки не склеены', diff.every((g) => g.redundant.length === 0));

  const unknown = findRedundant([
    { pid: 1, cwd: null, mb: 100, minutes: 10 },
    { pid: 2, cwd: null, mb: 100, minutes: 10 },
  ]);
  t('неизвестная папка не склеивается с чужой', unknown.every((g) => g.redundant.length === 0));

  const heavy = findRedundant([
    { pid: 1, cwd: '/a', mb: 100, minutes: 5 },
    { pid: 2, cwd: '/b', mb: 900, minutes: 5 },
    { pid: 3, cwd: '/b', mb: 900, minutes: 9 },
  ]);
  t('тяжёлая папка идёт первой', heavy[0].dir === '/b');

  const tree = rootsOnly([
    { pid: 100, ppid: 9, args: 'next dev' },
    { pid: 101, ppid: 100, args: 'next-server' },
    { pid: 102, ppid: 101, args: 'next-server' },
  ]);
  t('дерево одного сервера свёрнуто в один корень', tree.length === 1 && tree[0].pid === 100);

  const twoTrees = rootsOnly([
    { pid: 100, ppid: 9, args: 'next dev' },
    { pid: 101, ppid: 100, args: 'next-server' },
    { pid: 200, ppid: 9, args: 'next dev' },
    { pid: 201, ppid: 200, args: 'next-server' },
  ]);
  t('два независимых сервера остались двумя', twoTrees.length === 2);

  t('одиночка остаётся корнем', rootsOnly([{ pid: 5, ppid: 1, args: 'next-server' }]).length === 1);
  t('обрыв цепочки не зацикливает', rootsOnly([{ pid: 7, ppid: 999999, args: 'next-server' }]).length === 1);

  const full = findRedundant(rootsOnly([
    { pid: 100, ppid: 9, args: 'next dev', cwd: '/a', mb: 10, minutes: 5 },
    { pid: 101, ppid: 100, args: 'next-server', cwd: '/a', mb: 1600, minutes: 5 },
  ]).map((x) => ({ ...x })));
  t('части одного сервера не объявлены дублями', full[0].redundant.length === 0);

  const fam = [
    { pid: 10, ppid: 1, mb: 1, args: 'next dev' },
    { pid: 11, ppid: 10, mb: 5, args: 'next-server' },
    { pid: 12, ppid: 11, mb: 5, args: 'worker' },
  ];
  t('вес считается по всему роду', attributeWeight(10, fam).mb === 11);
  t('сжатый вес перекрывает резидентный',
    attributeWeight(10, fam, new Map([[11, 3000]])).mb === 3006);
  t('вес одиночки — его собственный', attributeWeight(12, fam).mb === 5);
  t('несуществующий корень даёт ноль', attributeWeight(999, fam).mb === 0);

  t('подкачка велика И машина гребёт — задыхается',
    pressureLevel({ swapUsedGb: 12, load: 20, cores: 12 }) === 'задыхается');
  t('подкачка велика, но нагрузка спокойная — НЕ задыхается',
    pressureLevel({ swapUsedGb: 11.5, load: 5.07, cores: 12 }) === 'в подкачке');
  t('высокая нагрузка без подкачки — задыхается',
    pressureLevel({ swapUsedGb: 0, load: 20, cores: 8 }) === 'задыхается');
  t('всё в норме — спокойно',
    pressureLevel({ swapUsedGb: 2, load: 3, cores: 12 }) === 'спокойно');
  t('нет замера — не тревожим зря', pressureLevel(null) === 'спокойно');
  t('процент больше не решает: ужатый файл не даёт тревоги',
    pressureLevel({ swapUsedGb: 2, load: 3, cores: 8 }) === 'спокойно');

  console.log(`\n[самопроверка] пройдено ${ok}, провалено ${bad}`);
  return bad === 0 ? 0 : 1;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : main(process.argv.slice(2)));
}
