#!/usr/bin/env node
// judge-calibration — beyond a judge's ACCURACY: are the judges in AGREEMENT, and is any judge DRIFTING?
// Anthropic's agent-evals guide calibrates LLM judges. Accuracy alone hides two failure modes: a panel
// that is split (low inter-judge agreement → the verdict is a coin-flip), and a judge whose accuracy is
// falling run over run (drift → silent degradation). This measures both.
//
//   verdictRows: [{ case, judge, verdict }]   (multiple judges over shared cases → inter-judge agreement)
//   accuracySeries: { judge: [acc_run1, acc_run2, ...] }   (per-judge accuracy over runs → drift)
//
// HONEST boundary: agreement is mean pairwise exact-match over shared cases (a simple, transparent
// metric, not Cohen's kappa); drift is the sign of latest-minus-earliest beyond a 5pt band.
//
// FULL & self-tested. Usage:
//   node scripts/judge-calibration.mjs --self-test
//   node scripts/judge-calibration.mjs --verdicts <rows.json> --accuracy <series.json>

import { readFileSync, existsSync } from 'node:fs';

// pure: mean pairwise exact-match agreement across judges, over cases they BOTH judged
export function agreement(verdictRows = []) {
  const byCase = {};
  for (const r of verdictRows) (byCase[r.case] ??= {})[r.judge] = r.verdict;
  let pairs = 0, agree = 0;
  for (const verdicts of Object.values(byCase)) {
    const judges = Object.keys(verdicts);
    for (let i = 0; i < judges.length; i++) for (let j = i + 1; j < judges.length; j++) {
      pairs++;
      if (verdicts[judges[i]] === verdicts[judges[j]]) agree++;
    }
  }
  return pairs ? +(agree / pairs).toFixed(2) : 1; // no pairs (single judge) → vacuously 1
}

// pure: per-judge drift direction from an accuracy series (5pt band = stable)
export function drift(accuracySeries = {}) {
  const out = {};
  for (const [judge, series] of Object.entries(accuracySeries)) {
    if (!Array.isArray(series) || series.length < 2) { out[judge] = 'baseline'; continue; }
    const d = series[series.length - 1] - series[0];
    out[judge] = Math.abs(d) < 5 ? 'stable' : d > 0 ? 'improving' : 'DRIFTING';
  }
  return out;
}

/**
 * 2026-W35-B4 — НАДЁЖНОСТЬ судьи, а не одна его точка.
 *
 * Замер 2026-08-24: в десяти каталогах docs/evals лежит ровно ПО ОДНОМУ файлу прогона, и
 * все датированы 2026-05-31. Поэтому drift() выше структурно не может выйти из состояния
 * baseline: ему нужны две точки, а точка одна, восемьдесят пятый день. Судья считается
 * откалиброванным по одному броску монеты.
 *
 * Один прогон недетерминированной системы это не измерение, а анекдот. pass^k отвечает на
 * вопрос, который одна точка задать не может: сколько кейсов судья проходит ВО ВСЕХ k
 * попытках. Разница между accuracy и pass^k и есть мера его шаткости.
 *
 * @param {Record<string, boolean[]>} byCase кейс → исходы по попыткам
 * @returns {{cases:number, trials:number, passAll:number, passAny:number,
 *            passHatK:number, flaky:string[], spread:number}}
 */
export function multiTrial(byCase = {}) {
  const ids = Object.keys(byCase);
  const trials = ids.length ? Math.max(...ids.map((k) => byCase[k].length)) : 0;
  let passAll = 0, passAny = 0;
  const flaky = [];
  for (const id of ids) {
    const r = byCase[id] || [];
    const p = r.filter(Boolean).length;
    if (p === r.length && r.length > 0) passAll++;
    if (p > 0) passAny++;
    // шаткий = проходит иногда. Именно эти кейсы одна точка показывает как решённые.
    if (p > 0 && p < r.length) flaky.push(id);
  }
  const n = ids.length || 1;
  return {
    cases: ids.length,
    trials,
    passAll,
    passAny,
    passHatK: Math.round((100 * passAll) / n),
    flaky,
    // разброс: насколько «лучший из прогонов» расходится с «во всех прогонах».
    // Ноль значит судья устойчив; всё, что больше, это цена одной точки.
    spread: Math.round((100 * (passAny - passAll)) / n),
  };
}

// pure: calibration report + alerts (low agreement OR any drifting judge)
export function calibrate({ verdictRows = [], accuracySeries = {} } = {}, { minAgreement = 0.7 } = {}) {
  const agr = agreement(verdictRows);
  const dr = drift(accuracySeries);
  const drifting = Object.entries(dr).filter(([, v]) => v === 'DRIFTING').map(([j]) => j);
  const alerts = [];
  if (agr < minAgreement) alerts.push(`inter-judge agreement ${agr} < ${minAgreement} — the panel is split`);
  for (const j of drifting) alerts.push(`judge "${j}" is DRIFTING (accuracy falling)`);
  return { agreement: agr, drift: dr, alerts, ok: alerts.length === 0 };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const fullAgree = [{ case: '1', judge: 'a', verdict: 'PASS' }, { case: '1', judge: 'b', verdict: 'PASS' }, { case: '2', judge: 'a', verdict: 'FAIL' }, { case: '2', judge: 'b', verdict: 'FAIL' }];
  const split = [{ case: '1', judge: 'a', verdict: 'PASS' }, { case: '1', judge: 'b', verdict: 'FAIL' }, { case: '2', judge: 'a', verdict: 'PASS' }, { case: '2', judge: 'b', verdict: 'FAIL' }];

  ok('agreement: judges always agree → 1', agreement(fullAgree) === 1);
  ok('agreement: judges always split → 0', agreement(split) === 0);
  ok('agreement: single judge → 1 (vacuous, no false split)', agreement([{ case: '1', judge: 'a', verdict: 'PASS' }]) === 1);
  ok('drift: rising accuracy → improving', drift({ j: [60, 80] }).j === 'improving');
  ok('drift: falling accuracy → DRIFTING', drift({ j: [90, 70] }).j === 'DRIFTING');
  ok('drift: within 5pt → stable', drift({ j: [88, 90] }).j === 'stable');
  ok('drift: single reading → baseline', drift({ j: [90] }).j === 'baseline');

  // ── 2026-W35-B4: одна точка это не измерение ───────────────────────────────
  ok('РАСХОЖДЕНИЕ: по одному прогону кейс решён, по трём — шаткий',
    (() => {
      const oneTrial = multiTrial({ a: [true] });          // «100% решено»
      const threeTrials = multiTrial({ a: [true, false, true] }); // на деле шатается
      return oneTrial.passHatK === 100 && threeTrials.passHatK === 0 && threeTrials.flaky.includes('a');
    })());
  ok('pass^k: проходит во всех попытках → 100', multiTrial({ a: [true, true, true] }).passHatK === 100);
  ok('pass^k: одна осечка из трёх обнуляет кейс', multiTrial({ a: [true, true, false] }).passHatK === 0);
  ok('шаткие кейсы названы поимённо',
    multiTrial({ a: [true, false], b: [true, true] }).flaky.join() === 'a');
  ok('разброс это цена одной точки: лучший прогон минус все прогоны',
    multiTrial({ a: [true, false], b: [true, true] }).spread === 50);
  ok('устойчивый судья даёт нулевой разброс', multiTrial({ a: [true, true], b: [false, false] }).spread === 0);
  ok('число попыток берётся из данных, а не задаётся на глаз',
    multiTrial({ a: [true, true, true] }).trials === 3);
  ok('пустой вход не притворяется измерением',
    multiTrial({}).cases === 0 && multiTrial({}).trials === 0);

  // ── разбор вердикта отказывается угадывать (пойманный случай 2026-08-24) ────
  ok('РАСХОЖДЕНИЕ: текст ошибки содержит FAIL, но вердиктом не является',
    parseVerdict('Failed to authenticate: OAuth session expired and could not be refreshed') === 'UNPARSED');
  ok('чистый вердикт распознаётся', parseVerdict('PASS\nпричина') === 'PASS');
  ok('вердикт со знаками препинания распознаётся', parseVerdict('**VIOLATION**\nпричина') === 'VIOLATION');
  ok('пустой ответ это UNPARSED, а не проход', parseVerdict('') === 'UNPARSED');
  ok('строка про вердикт внутри предложения не засчитывается',
    parseVerdict('Я считаю, что это PASS по всем критериям') === 'UNPARSED');
  ok('calibrate: split panel raises an alert', calibrate({ verdictRows: split }).ok === false && calibrate({ verdictRows: split }).alerts.some((a) => /split/.test(a)));
  ok('calibrate: a drifting judge raises an alert', calibrate({ accuracySeries: { x: [90, 70] } }).alerts.some((a) => /DRIFTING/.test(a)));
  ok('calibrate: agreeing panel + stable judges → ok', calibrate({ verdictRows: fullAgree, accuracySeries: { x: [88, 90] } }).ok === true);

  if (fails.length) { console.log(`\n\x1b[31mjudge-calibration self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ judge-calibration: agreement + drift detection correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const load = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  // --multi-trial: ПРОИЗВЕСТИ недостающие точки, а не подождать их (2026-W35-B4)
  if (process.argv.includes('--multi-trial')) {
    const slug = arg('--agent');
    const trials = Number(arg('--trials') || 2);
    const today = arg('--date') || new Date().toISOString().slice(0, 10);
    if (!slug) { console.error('нужно --agent <slug> [--trials N]'); process.exit(2); }
    const { spawn } = await import('node:child_process');
    const callModel = (prompt) => new Promise((resolve) => {
      const child = spawn('claude', ['--print'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      const kill = setTimeout(() => { try { child.kill(); } catch { /* уже мёртв */ } resolve(''); }, 180000);
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => { clearTimeout(kill); resolve(out); });
      child.on('error', () => { clearTimeout(kill); resolve(''); });
      child.stdin.write(prompt); child.stdin.end();
    });
    let written;
    try {
      written = await runTrials({ slug, trials, root: '.', spawnFn: callModel, today });
    } catch (e) {
      // Отказ ПИСАТЬ это правильный исход, а не авария: лучше ноль точек, чем
      // правдоподобные точки из текста ошибки.
      console.error(`\x1b[31m✗ многотрайловый прогон ${slug} не дал данных\x1b[0m`);
      console.error('  ' + String(e.message).split('\n').join('\n  '));
      console.error('  Ни одного файла не записано. Проверь доступ к модели: claude --print <<< "ping"');
      process.exit(1);
    }
    console.log(`многотрайловый прогон ${slug}: ${written.length} файл(ов)`);
    for (const p of written) console.log('  ' + p);
    process.exit(0);
  }

  const verdictRows = load(arg('--verdicts')) || [];
  const accuracySeries = load(arg('--accuracy')) || {};
  if (!verdictRows.length && !Object.keys(accuracySeries).length) { console.error('usage: --verdicts <rows.json> --accuracy <series.json>  (or --self-test)'); process.exit(2); }
  const r = calibrate({ verdictRows, accuracySeries });
  console.log(`judge-calibration: inter-judge agreement ${r.agreement}\n  drift: ${JSON.stringify(r.drift)}`);
  if (!r.ok) { console.error(`\n\x1b[31m✗ ${r.alerts.length} calibration alert(s):\x1b[0m`); for (const a of r.alerts) console.error(`    ${a}`); process.exit(1); }
  console.log('\x1b[32m✓ judges are calibrated (agreeing + not drifting).\x1b[0m');
  process.exit(0);
}

// ── 2026-W35-B4: многотрайловый прогон, который ПРОИЗВОДИТ данные ────────────
// Механизм без данных это ровно тот дефект, который мы весь август и ловим (три пустых
// механизма от 2026-08-22). Поэтому здесь не только счётчик, но и бегунок, который
// создаёт недостающие точки: docs/evals/<судья>/run-<дата>-t<N>.jsonl.
//
// УСЛОВИЕ СМЕРТИ, записанное вместе с рекомендацией: если через 14 дней после 2026-08-24
// в docs/evals не появится ни одного файла run-*-t2.jsonl, бегунок снимается и уходит в
// _REJECTED с категорией «требует живого прогона модели». Механизм, который никто не
// запускает, честнее удалить, чем оставить украшением.
/**
 * 2026-W35-B4 — разбор вердикта, который отказывается угадывать.
 *
 * Первая версия искала подстроку `/VIOLATION|BLOCK|FAIL/` в первой строке. 2026-08-24
 * `claude --print` вернул «Failed to authenticate: OAuth session expired», разбор нашёл в
 * этом FAIL и записал вердикт VIOLATION. Четыре файла данных оценки оказались текстом
 * ошибки, отформатированным как результат. Поймано чтением сырого ответа, а не проверкой.
 *
 * Поэтому вердикт признаётся, только если первая непустая строка СОСТОИТ из него, с
 * точностью до знаков препинания. Всё остальное — честное UNPARSED, а не догадка.
 *
 * @param {string} out
 * @returns {'PASS'|'VIOLATION'|'UNPARSED'}
 */
export function parseVerdict(out) {
  const first = String(out || '').trim().split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
  const token = first.replace(/[^A-Za-zА-Яа-я]/g, '').toUpperCase();
  if (token === 'PASS' || token === 'OK') return 'PASS';
  if (token === 'VIOLATION' || token === 'BLOCK' || token === 'FAIL') return 'VIOLATION';
  return 'UNPARSED';
}

export async function runTrials({ slug, trials = 2, root = '.', spawnFn, today = '' } = {}) {
  const fsm = await import('node:fs');
  const pathm = await import('node:path');
  const dir = pathm.join(root, 'docs', 'evals', slug);
  const casesPath = pathm.join(dir, 'golden-cases.jsonl');
  if (!fsm.existsSync(casesPath)) throw new Error(`нет золотых кейсов: ${casesPath}`);
  const cases = fsm.readFileSync(casesPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const promptPath = pathm.join(root, '.claude', 'agents', `${slug}.md`);
  const agentPrompt = fsm.existsSync(promptPath) ? fsm.readFileSync(promptPath, 'utf8') : '';
  const written = [];
  for (let t = 1; t <= trials; t++) {
    const rows = [];
    for (const c of cases) {
      const prompt = `${agentPrompt}\n\n---\nОцени этот вход и ответь ОДНИМ словом-вердиктом в первой строке (PASS или VIOLATION), затем одной строкой причину.\n\nВХОД:\n${c.input}\n`;
      const out = await spawnFn(prompt);
      const verdict = parseVerdict(out);
      rows.push({ case_id: c.case_id, verdict, reason: String(out || '').trim().split('\n').slice(1).join(' ').slice(0, 300), agent: slug, date: today, trial: t });
    }
    // ФАЙЛ НЕ ПИШЕТСЯ, если хоть один ответ не разобрался. Пойманный случай 2026-08-24:
    // `claude --print` вернул «Failed to authenticate: OAuth session expired», разбор увидел
    // в этом слово FAIL и записал VIOLATION. Так из текста ошибки получились данные оценки,
    // выглядящие законно. Прибор, который при сбое источника производит правдоподобные
    // числа, хуже прибора, который молчит.
    const bad = rows.filter((r) => r.verdict === 'UNPARSED');
    if (bad.length) {
      throw new Error(
        `попытка ${t}: ${bad.length} из ${rows.length} ответов не содержат вердикта — файл НЕ записан.\n` +
        `  Скорее всего модель недоступна (истёкшая сессия, нет сети). Первый ответ: ` +
        `${JSON.stringify(String(rows[0] && rows[0].reason || '').slice(0, 160))}`,
      );
    }
    const p = pathm.join(dir, `run-${today}-t${t}.jsonl`);
    fsm.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    written.push(p);
  }
  return written;
}
