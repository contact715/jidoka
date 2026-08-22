#!/usr/bin/env node
// @closes-class: self-test-blindspot
// selftest-reality — the gate for the self-test-blindspot class.
//
// THE CLASS IT GATES (3 recurring incidents): a self-test reads GREEN but never actually exercised the
// behaviour. The worst form: a broken isMain guard made `--self-test` exit 0 while the body never ran
// (the macOS /var-symlink incident — process.argv.includes / argv[1]===fileURLToPath without realpath).
// A self-test that exits 0 having ASSERTED NOTHING proves nothing; it is a blindspot, not a pass.
//
// THE MECHANISM: run every script that declares a self-test, and flag any that exits 0 while producing
// ZERO assertion output. That is the exact fingerprint of "the test never ran". This gate itself uses a
// realpath-robust isMain guard, so it cannot fall into the very bug it gates.
//
// HONEST BOUNDARY: this catches the never-ran / asserted-nothing form mechanically. The softer form
// (a self-test that runs but only on unrealistic fixtures) is reported as a WARN for thin self-tests
// (≤1 assertion marker), not blocked — you cannot prove a fixture is unrealistic without real data.
//
// FULL & self-tested. Usage:
//   node scripts/selftest-reality.mjs            # scan all self-test scripts; exit 1 on any blindspot
//   node scripts/selftest-reality.mjs --changed  # only self-test scripts in the git diff (fast)
//   node scripts/selftest-reality.mjs --self-test

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── pure core (unit-tested, no subprocess) ──────────────────────────────────
// Assertion markers that prove a self-test actually checked something: the house ✓/✗ lines, a
// pass/fail word, an N/N ratio, or an assert call surfaced in output.
//
// ЛАТИНСКАЯ СЛЕПОТА (замер 2026-08-22). Все маркеры выше опознают только латиницу и символы.
// `research-audit.mjs` печатает по-русски «36 прошло, 0 упало»: ни галочки, ни латинского
// слова, ни дроби N/N. Детектор видел пустую строку и объявлял ЖИВУЮ самопроверку из 36
// утверждений пустышкой. CI на main из-за этого стоял красным четыре дня (18-22 августа),
// и красным по ложному поводу — что хуже зелёного по ложному, потому что учит не верить гейту.
// Это тот же класс, что `ascii-word-boundary-blind-in-cyrillic` (2026-08-08): граница слова и
// словарь маркеров описаны латиницей, и на другом алфавите механизм молча судит по пустоте.
//
// Русская половина НАМЕРЕННО строже латинской: она требует НЕНУЛЕВОГО числа рядом со словом.
// «0 прошло, 0 упало» это ровно та пустышка, которую гейт ловит, и она не должна проходить
// только потому, что напечатана по-русски. Латинскую половину не трогаю: менять её поведение
// в этой правке значит смешать починку класса с расширением области.
const ASSERTION_RE = /[✓✗]|\bpass(?:ed|es)?\b|\bfail(?:ed|s|ure)?\b|\bok\b|\b\d+\s*\/\s*\d+\b|\bassert|\b[1-9]\d*\s*(?:прошл|упал|провал|проверок|проверк|утвержд|ошибок)/i;

// СВОДНАЯ СТРОКА как сильный сигнал. «36 прошло, 0 упало» это отчёт о ПОЛНОМ прогоне, а не
// один тонкий маркер: пара «сколько прошло / сколько упало» доказывает, что счётчик считал.
// Без этого правила такая строка попадала в `thin` (предупреждение навсегда) только потому,
// что вторая половина пары равна нулю, а ноль я намеренно не засчитываю поодиночке.
const SUMMARY_PAIR_RE = /\b(\d+)\s*(?:прошл\w*|проверок|проверк\w*)\D{0,20}\b(\d+)\s*(?:упал\w*|провал\w*|ошибок)/i;

/** Сводная пара засчитывается ТОЛЬКО если хотя бы одно из двух чисел ненулевое. «0 прошло,
 *  0 упало» это и есть пустышка, которую гейт ловит; распознать её как полный прогон значило бы
 *  чинить ложную тревогу ценой ложного зелёного, то есть менять ошибку на худшую. */
export function summaryPair(text) {
  const m = SUMMARY_PAIR_RE.exec(text || '');
  if (!m) return null;
  const passed = Number(m[1]), failed = Number(m[2]);
  return { passed, failed, real: passed + failed > 0 };
}

// A script declares a self-test if it handles the --self-test flag AND names a selfTest function.
export function declaresSelfTest(src) {
  return /--self-test/.test(src) && /selfTest/.test(src);
}

// Classify one run by (exit code, captured output):
//   blindspot — exit 0 but no assertion output  → the bug we gate (green, proved nothing)
//   failing   — non-zero exit                    → a real self-test failure (test-runner's concern)
//   thin      — exit 0, asserted, but only one marker → ran on too little (WARN, not block)
//   real      — exit 0 with assertion output
export function classifyRun({ exit, output }) {
  const text = output || '';
  const markers = (text.match(new RegExp(ASSERTION_RE, 'gi')) || []).length;
  if (exit !== 0) return 'failing';
  // сводная пара «N прошло / M упало» — доказательство полного прогона, даже если M равно нулю
  const pair = summaryPair(text);
  if (pair) return pair.real ? 'real' : 'blindspot';
  if (markers === 0) return 'blindspot';
  if (markers === 1) return 'thin';
  return 'real';
}

// ── fs/subprocess scan (impure) ─────────────────────────────────────────────
function scriptsWithSelfTest(only = null) {
  let names = readdirSync(HERE).filter((f) => f.endsWith('.mjs'));
  if (only && only.length) names = names.filter((f) => only.includes(f));
  return names.filter((f) => {
    try { return declaresSelfTest(readFileSync(join(HERE, f), 'utf8')); } catch { return false; }
  });
}

function runSelfTest(file) {
  let exit = 0; let output = '';
  try {
    output = execSync(`node ${JSON.stringify(join(HERE, file))} --self-test`, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { exit = e.status ?? 1; output = `${e.stdout || ''}${e.stderr || ''}`; }
  return { file, verdict: classifyRun({ exit, output }) };
}

function changedSelfTestFiles() {
  try {
    return execSync('git diff --name-only HEAD; git diff --cached --name-only', { cwd: dirname(HERE), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter((l) => l.startsWith('scripts/') && l.endsWith('.mjs')).map((l) => l.replace('scripts/', ''));
  } catch { return []; }
}

function scan(only) {
  const files = scriptsWithSelfTest(only);
  const results = files.map(runSelfTest);
  const blindspots = results.filter((r) => r.verdict === 'blindspot');
  const failing = results.filter((r) => r.verdict === 'failing');
  const thin = results.filter((r) => r.verdict === 'thin');
  console.log(`selftest-reality: scanned ${files.length} self-test script(s)`);
  if (thin.length) console.log(`\x1b[33m  ⚠ thin (one assertion only): ${thin.map((r) => r.file).join(', ')}\x1b[0m`);
  if (failing.length) console.log(`\x1b[33m  ⚠ failing self-test (separate concern): ${failing.map((r) => r.file).join(', ')}\x1b[0m`);
  if (blindspots.length) {
    console.log(`\x1b[31m  ✗ BLINDSPOT — exits 0 but asserts nothing (the self-test never really ran):\x1b[0m`);
    for (const b of blindspots) console.log(`\x1b[31m      ${b.file}\x1b[0m`);
    console.log(`\x1b[31m  → A green self-test that proves nothing is worse than none. Fix the isMain guard / add real assertions.\x1b[0m`);
    process.exit(1);
  }
  console.log('\x1b[32m✓ every self-test actually asserts (no blindspots)\x1b[0m');
  process.exit(0);
}

// ── self-test (pure classifier — the gate proves its own logic) ─────────────
function selfTest() {
  let f = 0;
  const ok = (n, c) => { if (!c) f++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  ok('exit 0 + assertion output → real', classifyRun({ exit: 0, output: '  ✓ a\n  ✓ b\n✓ all correct' }) === 'real');
  ok('exit 0 + NO assertion output → blindspot (the never-ran bug)', classifyRun({ exit: 0, output: 'starting up\nloaded config\n' }) === 'blindspot');
  ok('exit 0 + empty output → blindspot', classifyRun({ exit: 0, output: '' }) === 'blindspot');
  ok('non-zero exit → failing (not a blindspot)', classifyRun({ exit: 1, output: '✗ x failed' }) === 'failing');
  ok('exit 0 + single marker → thin (warn, not block)', classifyRun({ exit: 0, output: '✓ only one check' }) === 'thin');
  ok('declaresSelfTest: needs both --self-test and selfTest', declaresSelfTest("if(argv.includes('--self-test')) selfTest()") === true && declaresSelfTest('console.log("hi")') === false);
  ok('N/N ratio counts as assertion', classifyRun({ exit: 0, output: '11/11 green and 3/3 ok' }) === 'real');
  // кириллица (2026-08-22) — живая самопроверка на русском не должна читаться как пустышка
  ok('русский вывод «36 прошло, 0 упало» → real, а не blindspot',
    classifyRun({ exit: 0, output: '\nresearch-audit самопроверка: 36 прошло, 0 упало\n' }) === 'real');
  ok('русское «15 проверок пройдено» засчитывается',
    classifyRun({ exit: 0, output: '15 проверок пройдено' }) !== 'blindspot');
  ok('русская сводная пара «0 прошло, 0 упало» — прогон был, но пустой: НЕ real',
    classifyRun({ exit: 0, output: 'самопроверка: 0 прошло, 0 упало' }) !== 'real');
  ok('русское «0 прошло, 5 упало» засчитывается (падение это тоже утверждение)',
    classifyRun({ exit: 0, output: 'самопроверка: 0 прошло, 5 упало' }) !== 'blindspot');
  ok('русское слово БЕЗ числа не засчитывается (иначе прошла бы любая проза)',
    classifyRun({ exit: 0, output: 'запускаю проверку, всё прошло гладко' }) === 'blindspot');
  if (f) { console.log(`\n\x1b[31mselftest-reality self-test FAILED (${f})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ selftest-reality: blindspot classifier correct\x1b[0m'); process.exit(0);
}

// realpath-robust isMain — the gate must not fall into the symlink-guard bug it exists to catch.
const isMain = (() => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  else scan(process.argv.includes('--changed') ? changedSelfTestFiles() : null);
}
