#!/usr/bin/env node
// control-red — КОНТРОЛЬНЫЙ КРАСНЫЙ для разовой проверки: прежде чем зелёный на цели что-то
// значит, тот же прибор в той же среде обязан покраснеть на заведомо сломанном варианте.
//
// ЗАЧЕМ. Класс verified-where-failure-cannot-show (2026-09-25, сайт A+ Heating & Air, три
// случая за одну сессию): проверка давала «зелёный» там, где проверяемый сбой не мог
// проявиться.
//   1. Lighthouse локально показал CLS 0: шрифты приходили раньше первого кадра, подмена
//      шрифта была невозможна. На бою CLS 0,019.
//   2. Подогнанный запасной шрифт проверен только на Mac, где Arial установлен. На Linux и
//      Android Arial нет, и запасной не срабатывал.
//   3. Прокрутка проверялась в скрытой панели браузера, где плавная прокрутка не
//      выполняется: «до» и «после» были 0.
// Во всех трёх прибор был исправен. Слепой была СРЕДА, а на цели слепота неотличима от успеха.
//
// ЧТО ДЕЛАЕТ. Выполняет две команды одним прибором: на заведомо сломанном варианте (контроль)
// и на проверяемом (цель). Вердикт выносит сам, по числу из вывода или по коду возврата.
// Доказательством служит исполненная команда, а не фраза «я проверил».
//
//   proven        контроль красный, цель зелёная                 код 0
//   target-red    контроль красный, цель красная: сбой на цели    код 1
//   blind         контроль зелёный: прибор здесь слеп             код 3  (цель не запускается)
//   inconclusive  контроль или цель не дали ответа                код 4
//
// Цель при слепом контроле не запускается вовсе: её зелёный ничего бы не значил, а замер
// вроде Lighthouse стоит минуту.
//
// ЧЕГО ОН НЕ ДОКАЗЫВАЕТ. Что контроль сломан ИМЕННО тем сбоем, о котором заявление. Если
// заявление про «Arial нет», а контроль сломан чем-то другим, доказано будет другое. Поэтому
// условие обязательно называется словами (--condition) и печатается в вердикте: заявление
// «проверено» ограничено этим условием, и читатель видит, при каком.
//
// Родня: «красное плечо» (oracle-divergence.mjs#redArmFor) требует того же от приборов САМОГО
// движка через корпус кейсов. Здесь то же правило для проверки, которую делают один раз в
// проекте и никуда не регистрируют. Сторож заявлений: hooks/control-red-gate.mjs.
// Разбор и каталог слепых сред: docs/CONTROL_RED.md.
//
// Использование:
//   node scripts/control-red.mjs --condition "шрифты задержаны на 2,5 с" --control "node measure-cls.mjs --build old" --target "node measure-cls.mjs --build new" --metric "CLS=([0-9.,]+)" --max 0.01
//   node scripts/control-red.mjs --condition "..." --control "..." --target "..." --red-text "layout shift"
//   node scripts/control-red.mjs --self-test

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCli } from './lib/cli.mjs';

/** Строка вердикта. По ней сторож заявлений узнаёт исполненный прогон, поэтому её форма — договор. */
export const VERDICT_PREFIX = 'ВЕРДИКТ control-red:';
export const EXIT_OF = { proven: 0, 'target-red': 1, blind: 3, inconclusive: 4 };

const unknown = (why) => ({ state: 'unknown', value: null, why });

/** Чистая: число из строки; десятичная запятая допустима («0,0192»). Не число — null. */
export function parseNumber(s) {
  const t = String(s ?? '').trim().replace(',', '.');
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Чистая: прочитать одно плечо.
 *
 * Режим числа (rule.metric): решает ПОСЛЕДНЕЕ найденное число — прогрев и промежуточные
 * замеры печатаются раньше итога. Числа нет — ответа нет, а не зелёный.
 *
 * Режим кода возврата: 0 — зелёный. Ненулевой код засчитывается красным, только если в
 * выводе есть rule.redText. Без этого упавшая сама команда (нет модуля, опечатка в пути)
 * неотличима от поймавшей сбой, и контроль «покраснел бы» на собственной поломке.
 *
 * @param {{exitCode:number|null, signal?:string|null, timedOut?:boolean, spawnError?:string|null, output?:string}} run
 * @param {{metric?:RegExp|null, max?:number|null, min?:number|null, redText?:string|null}} rule
 * @returns {{state:'red'|'green'|'unknown', value:number|null, why:string}}
 */
export function readArm(run, rule = {}) {
  if (!run) return unknown('не запускалось');
  if (run.spawnError) return unknown(`не запустилось: ${run.spawnError}`);
  if (run.timedOut) return unknown('вышло время');
  if (run.signal) return unknown(`остановлено сигналом ${run.signal}`);
  const out = String(run.output || '');
  const code = run.exitCode;

  if (rule.metric) {
    const re = new RegExp(rule.metric.source, rule.metric.flags.includes('g') ? rule.metric.flags : rule.metric.flags + 'g');
    const hits = [...out.matchAll(re)];
    const value = hits.length ? parseNumber(hits[hits.length - 1][1]) : null;
    if (value === null) return unknown(`число не найдено в выводе${code ? ` (код ${code})` : ''}`);
    if (rule.max !== null && rule.max !== undefined) {
      return value > rule.max
        ? { state: 'red', value, why: `${value} > ${rule.max}` }
        : { state: 'green', value, why: `${value} ≤ ${rule.max}` };
    }
    return value < rule.min
      ? { state: 'red', value, why: `${value} < ${rule.min}` }
      : { state: 'green', value, why: `${value} ≥ ${rule.min}` };
  }

  if (code === 126 || code === 127) return unknown(`команда не исполнилась (код ${code})`);
  if (code === 0) return { state: 'green', value: 0, why: 'код 0' };
  if (!rule.redText) return unknown(`код ${code}, причина красного не задана (--red-text)`);
  return out.includes(rule.redText)
    ? { state: 'red', value: code, why: `код ${code}, в выводе «${rule.redText}»` }
    : unknown(`код ${code}, но «${rule.redText}» в выводе нет: упала сама команда, сбоя она не поймала`);
}

/**
 * Чистая: вердикт по двум плечам. `target === null` — цель не запускалась.
 * @returns {'proven'|'target-red'|'blind'|'inconclusive'}
 */
export function verdictOf(control, target) {
  if (!control || control.state === 'unknown') return 'inconclusive';
  if (control.state === 'green') return 'blind';
  if (!target || target.state === 'unknown') return 'inconclusive';
  return target.state === 'red' ? 'target-red' : 'proven';
}

/**
 * Чистая: ошибки вызова, которых разбор флагов не видит. Каждая — отдельная строка.
 * @param {{condition?:string, control?:string, target?:string, metric?:string, max?:number, min?:number, 'red-text'?:string}} v
 * @returns {string[]}
 */
export function callProblems(v = {}) {
  const out = [];
  const has = (x) => x !== undefined && x !== null && x !== '';
  if (!has(v.condition) || String(v.condition).trim().length < 8) {
    out.push('--condition: назови словами условие, при котором сбой проявился бы (не короче 8 символов)');
  }
  if (!has(v.control)) out.push('--control: нужна команда на заведомо сломанном варианте');
  if (!has(v.target)) out.push('--target: нужна команда на проверяемом варианте');
  if (has(v.control) && has(v.target) && String(v.control).trim() === String(v.target).trim()) {
    out.push('контроль и цель — одна и та же команда: контроль обязан быть сломанным вариантом');
  }
  if (has(v.metric)) {
    if (has(v.max) === has(v.min)) out.push('--metric требует ровно один порог: --max (больше — красный) или --min (меньше — красный)');
    try {
      new RegExp(v.metric);
      if (!/\((?!\?)/.test(v.metric)) out.push('--metric: нужна группа (…), в которой стоит число');
    } catch (e) {
      out.push(`--metric: выражение не разбирается: ${e.message}`);
    }
  } else {
    if (has(v.max) || has(v.min)) out.push('--max и --min работают только вместе с --metric');
    if (!has(v['red-text'])) {
      out.push('режим кода возврата требует --red-text: без названной причины красный контроль неотличим от упавшей команды');
    }
  }
  return out;
}

// ── непрозрачная часть ──────────────────────────────────────────────────────
function runArm(cmd, timeoutSec) {
  const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024 });
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  return {
    exitCode: r.status,
    signal: timedOut ? null : r.signal,
    timedOut,
    spawnError: r.error && !timedOut ? r.error.message : null,
    output: `${r.stdout || ''}${r.stderr || ''}`,
  };
}

const STATE_WORD = { red: 'КРАСНЫЙ', green: 'ЗЕЛЁНЫЙ', unknown: 'НЕТ ОТВЕТА' };
const VERDICT_TEXT = {
  proven: 'прибор видит сбой в этой среде, и на цели его нет',
  'target-red': 'прибор видит сбой, и сбой есть на цели',
  blind: 'на заведомо сломанном варианте прибор зелёный: в этой среде он сбоя не видит, и зелёный на цели ничего не доказывает. Создай условие и повтори',
  inconclusive: 'одно из плеч не дало ответа; это не «проверено»',
};

function tail(output, n = 4) {
  return String(output || '').split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-n);
}

function printArm(label, arm, run) {
  console.log(`  ${label.padEnd(30)} ${STATE_WORD[arm.state].padEnd(10)} ${arm.why}`);
  if (arm.state === 'unknown' && run) for (const l of tail(run.output)) console.log(`      │ ${l.slice(0, 160)}`);
}

function selfTest() {
  const fails = [];
  let ran = 0;
  const ok = (name, cond) => { ran++; if (!cond) fails.push(name); console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const CLS = { metric: /CLS=([0-9.,]+)/, max: 0.01 };
  const run = (output, exitCode = 0) => ({ exitCode, signal: null, timedOut: false, spawnError: null, output });

  // Главная проверка. Измеряемая величина «контроль покраснел» говорит «прибор видит сбой»,
  // а правило нарушено: покраснела сама команда (нет модуля, опечатка), сбоя она не ловила.
  ok('РАСХОЖДЕНИЕ: контроль упал сам, а не поймал сбой',
    readArm(run('Error: Cannot find module ./measure.mjs', 1), { redText: 'layout shift' }).state === 'unknown'
    && verdictOf(readArm(run('Error: Cannot find module', 1), { redText: 'layout shift' }), readArm(run('ok'), { redText: 'layout shift' })) === 'inconclusive');
  ok('красный с названной причиной засчитывается',
    readArm(run('FAIL: layout shift 0.0192', 1), { redText: 'layout shift' }).state === 'red');

  ok('случай 1: CLS локально, шрифты мгновенно — сломанная сборка тоже 0, прибор слеп',
    verdictOf(readArm(run('CLS=0'), CLS), null) === 'blind');
  ok('случай 1 с задержкой шрифтов на 2,5 с: 0,0192 против 0,0001 — доказано',
    verdictOf(readArm(run('CLS=0,0192'), CLS), readArm(run('CLS=0,0001'), CLS)) === 'proven');
  ok('сбой есть и на цели: вердикт target-red, а не «проверено»',
    verdictOf(readArm(run('CLS=0.0192'), CLS), readArm(run('CLS=0.015'), CLS)) === 'target-red');
  ok('случай 2: запасной шрифт на Mac, Arial есть — сломанная сборка не краснеет, прибор слеп',
    verdictOf(readArm(run('widthDelta=0.4'), { metric: /widthDelta=([0-9.,]+)/, max: 1 }), null) === 'blind');
  ok('случай 3: скрытая панель, прокрутка не идёт — сдвиг 0 и на сломанном варианте, прибор слеп',
    verdictOf(readArm(run('jump=0'), { metric: /jump=([0-9.,]+)/, max: 0 }), null) === 'blind');
  ok('--min: прокрутка обязана сдвинуть страницу хотя бы на 400',
    readArm(run('scrollY=0'), { metric: /scrollY=([0-9.,]+)/, min: 400 }).state === 'red'
    && readArm(run('scrollY=640'), { metric: /scrollY=([0-9.,]+)/, min: 400 }).state === 'green');
  ok('берётся ПОСЛЕДНЕЕ число: прогрев раньше итога',
    readArm(run('CLS=0.5 (прогрев)\nCLS=0.0001'), CLS).state === 'green');
  ok('код 127 — команда не исполнилась, это не красный',
    readArm(run('sh: lighthouse: command not found', 127), { redText: 'shift' }).state === 'unknown');
  ok('вышло время — это не красный',
    readArm({ exitCode: null, signal: 'SIGTERM', timedOut: true, spawnError: null, output: '' }, CLS).state === 'unknown');
  ok('число не найдено — это не зелёный',
    readArm(run('Lighthouse упал до замера', 0), CLS).state === 'unknown');
  ok('цель без ответа при красном контроле — не «доказано»',
    verdictOf(readArm(run('CLS=0.0192'), CLS), readArm(run('нет числа'), CLS)) === 'inconclusive');
  ok('десятичная запятая читается', parseNumber('0,0192') === 0.0192 && parseNumber('abc') === null);

  const base = { condition: 'шрифты задержаны на 2,5 с', control: 'node m.mjs old', target: 'node m.mjs new', metric: 'CLS=([0-9.]+)', max: 0.01 };
  ok('правильный вызов проходит', callProblems(base).length === 0);
  ok('условие сбоя не названо — отказ', callProblems({ ...base, condition: '' }).length === 1);
  ok('контроль и цель одна команда — отказ', callProblems({ ...base, target: base.control }).length === 1);
  ok('режим кода возврата без --red-text — отказ', callProblems({ ...base, metric: undefined, max: undefined }).length === 1);
  ok('--metric без порога — отказ', callProblems({ ...base, max: undefined }).length === 1);
  ok('--metric без группы с числом — отказ', callProblems({ ...base, metric: 'CLS=[0-9.]+' }).length === 1);

  if (fails.length) { console.log(`\n\x1b[31mcontrol-red self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ control-red: ${ran} прошло, 0 упало\x1b[0m`);
  process.exit(0);
}

export const CLI = {
  name: 'control-red',
  summary: 'Контрольный красный: тот же прибор на заведомо сломанном варианте обязан покраснеть, иначе зелёный на цели не засчитывается. Коды: 0 доказано, 1 сбой на цели, 3 прибор слеп, 4 нет ответа.',
  selfTest: true,
  options: {
    condition: { type: 'string', value: 'текст', desc: 'условие, при котором сбой проявился бы (обязательно)' },
    control: { type: 'string', value: 'команда', desc: 'прибор на заведомо сломанном варианте (обязательно)' },
    target: { type: 'string', value: 'команда', desc: 'тот же прибор на проверяемом варианте (обязательно)' },
    metric: { type: 'string', value: 'выражение', desc: 'регулярное выражение с группой (…), где стоит число; решает последнее найденное' },
    max: { type: 'number', desc: 'с --metric: больше порога — красный' },
    min: { type: 'number', desc: 'с --metric: меньше порога — красный' },
    'red-text': { type: 'string', value: 'текст', desc: 'без --metric: ненулевой код считается красным, только если в выводе есть этот текст' },
    timeout: { type: 'number', value: 'секунд', desc: 'предел на одно плечо (по умолчанию 300)' },
  },
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { values, selfTest: wantsSelfTest } = runCli(CLI);
  if (wantsSelfTest) selfTest();

  const problems = callProblems(values);
  if (problems.length) {
    for (const p of problems) console.error(`control-red: ${p}`);
    console.error('Ничего не выполнено. Справка: node scripts/control-red.mjs --help');
    process.exit(2);
  }

  const rule = {
    metric: values.metric ? new RegExp(values.metric) : null,
    max: values.max ?? null,
    min: values.min ?? null,
    redText: values['red-text'] || null,
  };
  const timeoutSec = values.timeout > 0 ? values.timeout : 300;

  console.log(`control-red · условие сбоя: ${values.condition}`);
  const controlRun = runArm(values.control, timeoutSec);
  const control = readArm(controlRun, rule);
  printArm('контроль (заведомо сломанный)', control, controlRun);

  let target = null;
  let targetRun = null;
  if (control.state === 'red') {
    targetRun = runArm(values.target, timeoutSec);
    target = readArm(targetRun, rule);
    printArm('цель', target, targetRun);
  } else {
    console.log(`  ${'цель'.padEnd(30)} не запускалась: ${control.state === 'green' ? 'при слепом приборе её зелёный ничего не значит' : 'контроль не дал ответа'}`);
  }

  const verdict = verdictOf(control, target);
  console.log(`${VERDICT_PREFIX} ${verdict} — ${VERDICT_TEXT[verdict]} (условие: ${values.condition})`);
  process.exit(EXIT_OF[verdict]);
}
