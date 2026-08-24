#!/usr/bin/env node
// session-collision — ловит момент, когда две сессии перебивают работу друг друга, и
// ОТКРЫВАЕТ между ними разговор вместо молчаливой поломки.
//
// @closes-class: parallel-work-invisible-across-sessions
// @scope: all
// @scope-ok: вход это индекс git и доска сессий, оба маленькие; сузить до правки нельзя,
//            потому что столкновение живёт именно в ЧУЖИХ файлах, которых в правке нет
// @divergence: "РАСХОЖДЕНИЕ: индекс пуст, а чужая работа уже там" — измеряемая величина
//              «мои файлы в порядке» говорит «чисто», а правило «в коммит уйдёт только моё»
//              нарушено: индекс общий на репозиторий, и чужое staged лежит в нём молча
//
// СЛУЧАЙ, РАДИ КОТОРОГО НАПИСАНО (2026-08-24, поймано на себе). Я правил один тест в
// projectx-app и сделал `git add` одного файла. В индексе к этому моменту УЖЕ лежали
// восемь файлов соседней сессии. Коммит утянул бы чужую незаконченную работу под мою
// подпись; спас случайный отказ чужого гейта, а не защита. Ни одна из двух сессий не
// знала о второй: доска сессий стоит с одной протухшей записью двухдневной давности,
// почта пуста.
//
// ЧЕМУ ЭТО НЕ РАВНО. Замок сессии (session-lock) не пускает вторую сессию в ту же папку.
// Здесь другое: сессии РАЗНЫЕ и работают законно, а сталкиваются об общий индекс git и
// об общие файлы. Замок такое не видит по построению.
//
// Использование:
//   node scripts/session-collision.mjs --check [--repo <путь>]   # выход 1 при столкновении
//   node scripts/session-collision.mjs --check --notify   # плюс письмо соседней сессии
//   node scripts/session-collision.mjs --self-test

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readBoard, matchesGlob, isStale } from './session-board.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Чистая: какие файлы в индексе заявлены ДРУГОЙ живой сессией.
 *
 * Это и есть «перебивается»: путь лежит в общем индексе, а хозяин у него другой.
 *
 * ВНИМАНИЕ на третий аргумент isStale: доска ждёт БУЛЕВО (результат предиката), а не сам
 * предикат. Проверено по её живым вызовам, а не по имени параметра: `isStale(e, now,
 * pidAlive(e.pid))`. Передать функцию значит молча отключить проверку pid.
 * @param {{staged:string[], board:Array<object>, me:string, now?:number, pidAliveOf?:(p:number)=>boolean}} o
 * @returns {Array<{file:string, owner:string, claim:string, note:string}>}
 */
export function stagedConflicts({ staged = [], board = [], me = '', now = Date.now(), pidAliveOf = () => true }) {
  const out = [];
  for (const entry of board) {
    if (!entry || entry.session === me) continue;
    // Протухшая запись это не сосед, а призрак: ругаться на неё значит учить пролистывать.
    if (isStale(entry, now, pidAliveOf(entry.pid))) continue;
    for (const claim of entry.claims || []) {
      for (const file of staged) {
        if (matchesGlob(claim, file)) {
          out.push({ file, owner: entry.session, claim, note: entry.note || '' });
        }
      }
    }
  }
  return out;
}

/**
 * Чистая: в индексе лежит ЧУЖОЕ, даже если доска молчит.
 *
 * Отдельная проверка нарочно. Доска наполняется, только если сосед о себе объявил, а
 * незаявленная сессия существует ровно так же. Индекс же общий на репозиторий всегда:
 * файл, которого нет среди моих, в коммит уедет вместе с моим.
 *
 * @param {{staged:string[], mine:string[]}} o
 * @returns {string[]}
 */
export function foreignStaged({ staged = [], mine = [] }) {
  const own = new Set(mine);
  return staged.filter((f) => !own.has(f));
}

/**
 * Чистая: что сказать соседу. Письмо это не уведомление «я тут был», а ВОПРОС с
 * предложением, иначе разговор не начинается.
 *
 * @param {{conflicts:Array<object>, foreign:string[], me:string}} o
 * @returns {Array<{to:string, type:string, subject:string, body:string}>}
 */
export function draftMessages({ conflicts = [], foreign = [], me = '' }) {
  const byOwner = new Map();
  for (const c of conflicts) {
    if (!byOwner.has(c.owner)) byOwner.set(c.owner, []);
    byOwner.get(c.owner).push(c);
  }
  const msgs = [];
  for (const [owner, list] of byOwner) {
    const files = [...new Set(list.map((c) => c.file))];
    msgs.push({
      to: owner,
      type: 'claim-query',
      subject: `пересекаемся на ${files.length} файл(ах)`,
      body: [
        `Сессия ${me} собирается коммитить, а эти файлы заявлены тобой:`,
        ...files.map((f) => `  ${f}`),
        list[0].note ? `Твоя заметка: ${list[0].note}` : '',
        'Предлагаю: я коммичу ТОЛЬКО свои пути, твои оставляю в индексе нетронутыми.',
        'Ответь release, если закончил, или warning, если правишь прямо сейчас.',
      ].filter(Boolean).join('\n'),
    });
  }
  // Чужое в индексе без владельца на доске: адресата нет, но молчать нельзя.
  if (foreign.length && !msgs.length) {
    msgs.push({
      to: 'all',
      type: 'warning',
      subject: `в индексе ${foreign.length} чужих файл(ов)`,
      body: [
        `Сессия ${me} нашла в общем индексе файлы, которых не добавляла:`,
        ...foreign.slice(0, 10).map((f) => `  ${f}`),
        'Хозяин не объявлен на доске. Кто это, отзовись: node scripts/session-board.mjs --publish',
      ].join('\n'),
    });
  }
  return msgs;
}

/** Чистая: итоговый вердикт. Столкновение это ЧУЖОЕ в индексе, а не любое пересечение. */
export function collisionVerdict({ conflicts = [], foreign = [] }) {
  if (conflicts.length) return 'claimed-by-other';
  if (foreign.length) return 'foreign-in-index';
  return 'clear';
}

/**
 * Чистая: БЛОКИРОВАТЬ или только сказать.
 *
 * Соразмерность важнее строгости. «Чужое в индексе» доказуемо только когда есть чем
 * доказать своё: если сессия себя на доске не объявила, мы не знаем, где чьё, и блокировать
 * на этом основании значит останавливать каждый первый коммит. Такой гейт обходят в первый
 * же день, и тогда не остаётся ни гейта, ни доски.
 *
 * Заявка соседа — другое дело: там владелец назван поимённо, и это уже доказательство.
 *
 * @param {{verdict:string, hasOwnEntry:boolean}} o
 * @returns {'block'|'warn'|'pass'}
 */
export function enforcement({ verdict }) {
  if (verdict === 'claimed-by-other') return 'block';
  // «Нет в моих заявках» БЛОКИРОВКОЙ не является, и это выяснилось на собственном коммите.
  // Заявки собирает хук на Write/Edit, а правки через Bash (sed, python) он не видит по
  // построению, поэтому набор «моего» неполон всегда. Блокировать по неполному признаку
  // значит ронять свои же коммиты и научить обходить гейт в первый день. Единственное
  // надёжное доказательство чужого — ЗАЯВКА другой живой сессии, где владелец назван.
  if (verdict === 'foreign-in-index') return 'warn';
  return 'pass';
}

// ── непрозрачная часть ──────────────────────────────────────────────────────
const git = (args, cwd = ROOT) => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); } catch { return ''; }
};

export function stagedFiles(cwd = ROOT) {
  const out = git(['diff', '--cached', '--name-only'], cwd);
  return out ? out.split('\n').filter(Boolean) : [];
}

function selfTest() {
  const fails = [];
  let ran = 0;
  const ok = (n, c) => { ran++; if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const alive = () => true;
  const NOW = 1_700_000_000_000;
  const entry = (session, claims, extra = {}) => ({ session, claims, updatedAt: NOW, pid: 1, note: 'правлю карточку', ...extra });

  // ── столкновение по заявке ────────────────────────────────────────────────
  ok('файл в индексе, заявленный ДРУГОЙ сессией, это столкновение',
    stagedConflicts({ staged: ['components/Card.tsx'], board: [entry('other-1', ['components/**'])], me: 'me-1', now: NOW, pidAliveOf: alive }).length === 1);
  ok('мои собственные заявки столкновением не считаются',
    stagedConflicts({ staged: ['components/Card.tsx'], board: [entry('me-1', ['components/**'])], me: 'me-1', now: NOW, pidAliveOf: alive }).length === 0);
  ok('ПРОТУХШАЯ запись это призрак, а не сосед',
    stagedConflicts({ staged: ['components/Card.tsx'], board: [entry('other-1', ['components/**'], { updatedAt: NOW - 9e8, pid: 999999 })], me: 'me-1', now: NOW, pidAliveOf: () => false }).length === 0);
  ok('столкновение называет хозяина и заявку',
    (() => { const c = stagedConflicts({ staged: ['lib/a.ts'], board: [entry('other-1', ['lib/**'])], me: 'me-1', now: NOW, pidAliveOf: alive })[0]; return c.owner === 'other-1' && c.claim === 'lib/**'; })());
  ok('непересекающиеся пути молчат',
    stagedConflicts({ staged: ['docs/a.md'], board: [entry('other-1', ['lib/**'])], me: 'me-1', now: NOW, pidAliveOf: alive }).length === 0);

  // ── чужое в индексе БЕЗ доски ─────────────────────────────────────────────
  // Это и есть кейс расхождения: доска пуста, «мои файлы в порядке», а коммит утянет чужое.
  ok('РАСХОЖДЕНИЕ: индекс пуст, а чужая работа уже там',
    (() => {
      const staged = ['lib/mine.ts', 'components/theirs.tsx'];
      const conflicts = stagedConflicts({ staged, board: [], me: 'me-1', now: NOW, pidAliveOf: alive });
      const foreign = foreignStaged({ staged, mine: ['lib/mine.ts'] });
      return conflicts.length === 0 && foreign.length === 1 && collisionVerdict({ conflicts, foreign }) === 'foreign-in-index';
    })());
  ok('только мои файлы в индексе — чисто',
    collisionVerdict({ conflicts: [], foreign: foreignStaged({ staged: ['a.ts'], mine: ['a.ts'] }) }) === 'clear');
  ok('заявленное соседом важнее безымянного чужого',
    collisionVerdict({ conflicts: [{ owner: 'x' }], foreign: ['y'] }) === 'claimed-by-other');

  // ── письмо ────────────────────────────────────────────────────────────────
  ok('письмо адресовано хозяину заявки, а не всем',
    draftMessages({ conflicts: [{ file: 'a.ts', owner: 'other-1', claim: 'a*', note: '' }], me: 'me-1' })[0].to === 'other-1');
  ok('письмо это ВОПРОС, требующий ответа, а не уведомление',
    draftMessages({ conflicts: [{ file: 'a.ts', owner: 'other-1', claim: 'a*', note: '' }], me: 'me-1' })[0].type === 'claim-query');
  ok('письмо несёт предложение, а не только жалобу',
    /Предлагаю/.test(draftMessages({ conflicts: [{ file: 'a.ts', owner: 'other-1', claim: 'a*', note: '' }], me: 'me-1' })[0].body));
  ok('одно письмо на соседа, а не на каждый файл',
    draftMessages({ conflicts: [
      { file: 'a.ts', owner: 'other-1', claim: '*', note: '' },
      { file: 'b.ts', owner: 'other-1', claim: '*', note: '' },
    ], me: 'me-1' }).length === 1);
  ok('безымянное чужое даёт предупреждение всем',
    (() => { const m = draftMessages({ conflicts: [], foreign: ['x.ts'], me: 'me-1' })[0]; return m.to === 'all' && m.type === 'warning'; })());
  ok('чисто — писем нет', draftMessages({ conflicts: [], foreign: [], me: 'me-1' }).length === 0);

  // ── соразмерность ─────────────────────────────────────────────────────────
  ok('заявка соседа блокирует всегда: владелец назван',
    enforcement({ verdict: 'claimed-by-other', hasOwnEntry: false }) === 'block');
  ok('РАСХОЖДЕНИЕ: файла нет в моих заявках, а он мой — правка шла через Bash',
    enforcement({ verdict: 'foreign-in-index' }) === 'warn');
  ok('объявленность сессии на строгость НЕ влияет: набор моего неполон всегда',
    enforcement({ verdict: 'foreign-in-index', hasOwnEntry: true }) === 'warn');
  ok('чисто — пропускаем', enforcement({ verdict: 'clear' }) === 'pass');
  ok('РАСХОЖДЕНИЕ: заявка свежая, но сессия УЖЕ мертва — не сосед, а призрак',
    stagedConflicts({ staged: ['lib/a.ts'], board: [entry('ghost', ['lib/**'], { pid: 999999 })], me: 'me-1', now: NOW, pidAliveOf: (p) => p !== 999999 }).length === 0);

  if (fails.length) { console.log(`\n\x1b[31msession-collision self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ session-collision: ${ran} прошло, 0 упало\x1b[0m`);
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  const argAfter = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  // Репозиторий задаётся явно: столкновение случается в ПРОДУКТЕ, а прибор живёт в движке.
  const repo = argAfter('--repo') || ROOT;
  const me = process.env.JIDOKA_SESSION || `${repo.split('/').pop()}-${String(process.pid).slice(-2)}`;
  const staged = stagedFiles(repo);
  if (!staged.length) { console.log('session-collision: индекс пуст — сталкиваться не о что.'); process.exit(0); }

  const board = readBoard();
  // Живость соседа проверяется НА САМОМ ДЕЛЕ, а не предполагается. Умолчание
  // «все живы» блокировало бы по заявке умершей сессии до истечения срока: поймано на
  // призраке собственного опыта, который держал коммит автора.
  const pidAliveOf = (pid) => { if (!pid) return true; try { process.kill(pid, 0); return true; } catch { return false; } };
  const conflicts = stagedConflicts({ staged, board, me, pidAliveOf });
  // «Моё» — то, что эта сессия объявила на доске. Не объявила ничего: значит доказать
  // принадлежность нечем, и весь индекс считается спорным. Это НЕ придирка: именно так
  // 2026-08-24 восемь чужих файлов оказались в моём `git add` незамеченными.
  const myEntry = board.find((e) => e && e.session === me);
  const mine = myEntry ? staged.filter((f) => (myEntry.claims || []).some((c) => matchesGlob(c, f))) : [];
  const foreign = foreignStaged({ staged, mine });
  const verdict = collisionVerdict({ conflicts, foreign });

  console.log(`session-collision — сессия ${me}, в индексе ${staged.length} файл(ов)`);
  if (verdict === 'clear') { console.log('  \x1b[32m✓ в индексе только заявленное этой сессией\x1b[0m'); process.exit(0); }

  if (conflicts.length) {
    console.log(`  \x1b[31m✗ ${conflicts.length} файл(ов) заявлены ДРУГИМИ живыми сессиями:\x1b[0m`);
    for (const c of conflicts.slice(0, 12)) console.log(`      ${c.file}  ← ${c.owner} (${c.claim})${c.note ? ' · ' + c.note : ''}`);
  }
  if (foreign.length) {
    console.log(`  \x1b[33m! ${foreign.length} файл(ов) в индексе не заявлены этой сессией:\x1b[0m`);
    for (const f of foreign.slice(0, 12)) console.log(`      ${f}`);
    if (!myEntry) console.log('      (эта сессия себя на доске не объявила, поэтому «своим» считать нечего)');
  }

  const msgs = draftMessages({ conflicts, foreign, me });
  if (process.argv.includes('--notify') && msgs.length) {
    for (const m of msgs) {
      try {
        execFileSync('node', [
          `${ROOT}/scripts/session-mail.mjs`, '--send', '--to', m.to, '--type', m.type,
          '--subject', m.subject, '--body', m.body, '--from', me,
        ], { cwd: ROOT, stdio: 'pipe' });
        console.log(`  \x1b[36m→ письмо отправлено: ${m.to} (${m.type})\x1b[0m`);
      } catch (e) {
        console.log(`  \x1b[33m! письмо не ушло к ${m.to}: ${String(e.message).split('\n')[0]}\x1b[0m`);
      }
    }
  } else if (msgs.length) {
    console.log(`  подсказка: --notify отправит ${msgs.length} письмо(писем) соседям.`);
  }

  console.log('\n  Как разойтись без потерь:');
  console.log('    git commit -- <только свои пути>     # чужое остаётся в индексе нетронутым');
  console.log('    node scripts/session-board.mjs --publish   # объявить, что правишь');
  console.log('    node scripts/session-mail.mjs            # прочитать ответ соседа');

  const action = enforcement({ verdict });
  if (action === 'warn') {
    console.log('\n  \x1b[33mПРЕДУПРЕЖДЕНИЕ, не блокировка.\x1b[0m Заявки собирает хук на Write/Edit, а правки');
    console.log('  через Bash он не видит, поэтому набор «моего» неполон и обвинять по нему нельзя.');
    console.log('  Блокирует только ЗАЯВКА другой живой сессии: там владелец назван поимённо.');
    process.exit(0);
  }
  process.exit(1);
}
