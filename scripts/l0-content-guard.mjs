#!/usr/bin/env node
// @scope: all
// @scope-ok: фиксированный короткий список L0-документов, 0,08 с
// l0-content-guard — the normative documents are watched by their CONTENT, not by their version.
//
// l0-normative-fingerprint (2026-W31-R5)
//
// THE HOLE. Three gates claim to watch drift around the constitution, and not one of them reads
// what it says:
//   cascade-validate.mjs            compares declared version numbers between parent and child
//   detect-constitutional-drift.mjs reads docs/audits/constitutional-events.jsonl — a stream of
//                                   violation RATES; it never opens the constitution at all
//   spec-drift-check.mjs            checks that references resolve
// So a normative rule can be INVERTED — "quality outranks speed and cost" rewritten into "speed
// and cost outrank quality, ship the cheapest thing" — with `version: 2.0.0` left untouched, and
// all three gates print byte-identical output. Every L1 child still reads COMPATIBLE, because
// the only thing anyone compared was a number the editor also controls.
//
// Verified, not assumed: detect-constitutional-drift.mjs contains exactly one readFileSync, and
// it points at the SDD config, never at a normative document. And the W32-R6 experiment showed
// the parent-child axis is blind the same way until a fingerprint is stamped.
//
// WHAT THIS DOES. Keeps a fingerprint of each normative document's BODY. On every run it
// recompares:
//   ok         body matches the stamp
//   AMENDED    body changed AND the version was bumped — a deliberate amendment, reported, allowed
//   INVERTED   body changed and the version did NOT move — the exact shape above, BLOCKED
//   unstamped  never recorded; reported, not blocked, so adoption is a deliberate act
//
// HONEST BOUNDARY, stated because it is the interesting part. The registry is a file, and a
// process that can rewrite the constitution can also rewrite the registry. This is not a defence
// against a determined attacker; it is a defence against the realistic failure, which is an edit
// nobody meant to be normative and nobody noticed. Every stamp demands a reason and is appended
// to an audit log, so re-stamping is visible rather than silent — the same boundary the L0 write
// grant and the permission ledger already declare.
//
// Zero dependencies. Usage:
//   node scripts/l0-content-guard.mjs --self-test
//   node scripts/l0-content-guard.mjs                          # check
//   node scripts/l0-content-guard.mjs --stamp --reason "..."    # record the current bodies

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = path.join(ROOT, 'docs/audits/l0-fingerprints.json');
const AUDIT = path.join(ROOT, 'docs/audits/l0-stamp-log.jsonl');

export const L0_NORMATIVE_DOCS = ['docs/CONSTITUTION.md', 'docs/MISSION.md', 'docs/NORTH_STAR.md'];

// ── pure core ────────────────────────────────────────────────────────────────

/** Body without frontmatter, whitespace-normalised. Pure. */
export function normativeBody(content = '') {
  let body = String(content);
  const fm = body.match(/^---\n[\s\S]*?\n---\n/);
  if (fm) body = body.slice(fm[0].length);
  return body.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

/** FNV-1a 32-bit hex of the normative body. Pure. */
export function fingerprint(content = '') {
  const s = normativeBody(content);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function declaredVersion(content = '') {
  const m = String(content).match(/^version:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * Verdict for one document. Pure.
 * @param {string} content  the file as it is now
 * @param {{fingerprint:string, version:string|null}|null} stamp  what was recorded
 */
export function judgeDoc(content, stamp) {
  const fp = fingerprint(content);
  const ver = declaredVersion(content);
  if (!stamp) return { status: 'unstamped', fingerprint: fp, version: ver, blocking: false };
  if (stamp.fingerprint === fp) return { status: 'ok', fingerprint: fp, version: ver, blocking: false };
  if (stamp.version && ver && stamp.version !== ver) {
    return { status: 'AMENDED', fingerprint: fp, version: ver, was: stamp.version, blocking: false };
  }
  return {
    status: 'INVERTED',
    fingerprint: fp,
    version: ver,
    blocking: true,
    why: `содержание нормативного документа изменилось, а версия осталась ${ver ?? '(не указана)'} — правка нормы без объявления поправки`,
  };
}

/** Verdicts for the whole set. Pure. */
export function judgeAll(docs, readDoc, registry = {}) {
  const rows = [];
  for (const rel of docs) {
    const content = readDoc(rel);
    if (content === null) { rows.push({ doc: rel, status: 'missing', blocking: false }); continue; }
    rows.push({ doc: rel, ...judgeDoc(content, registry[rel] || null) });
  }
  return { rows, blocked: rows.some((r) => r.blocking) };
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const base = ['---', 'version: 2.0.0', '---', '', '# Конституция', '', '§8 Качество важнее скорости и стоимости.'].join('\n');
  const fp = fingerprint(base);
  const stamp = { fingerprint: fp, version: '2.0.0' };

  ok('неизменённый документ проходит', judgeDoc(base, stamp).status === 'ok');
  ok('незарегистрированный документ не блокирует', judgeDoc(base, null).status === 'unstamped');
  ok('незарегистрированный отмечен как незарегистрированный, а не как ок', judgeDoc(base, null).blocking === false);

  // THE CASE: the rule is inverted, the version is untouched
  const inverted = base.replace('Качество важнее скорости и стоимости.', 'Скорость и стоимость важнее качества, отгружай самое дешёвое.');
  const v = judgeDoc(inverted, stamp);
  ok('перевёрнутая норма при той же версии → INVERTED', v.status === 'INVERTED');
  ok('перевёрнутая норма блокирует', v.blocking === true);
  ok('причина называет суть: норма изменилась, версия нет', /версия осталась 2\.0\.0/.test(v.why));

  // a deliberate amendment is allowed and reported
  const amended = inverted.replace('version: 2.0.0', 'version: 3.0.0');
  const a = judgeDoc(amended, stamp);
  ok('изменение содержания С поднятием версии это поправка, а не подмена', a.status === 'AMENDED');
  ok('поправка не блокирует', a.blocking === false);
  ok('поправка помнит прежнюю версию', a.was === '2.0.0');

  // reformatting is not meaning
  const reflowed = base.replace('§8 Качество важнее', '§8   Качество   важнее');
  ok('переформатирование не считается правкой нормы', judgeDoc(reflowed, stamp).status === 'ok');
  ok('правка ТОЛЬКО во frontmatter не двигает отпечаток', fingerprint(base.replace('version: 2.0.0', 'version: 2.0.1')) === fp);

  // a single inverted doc blocks the whole set
  const docs = ['a.md', 'b.md'];
  const read = (r) => (r === 'a.md' ? base : inverted);
  const reg = { 'a.md': stamp, 'b.md': stamp };
  const all = judgeAll(docs, read, reg);
  ok('один перевёрнутый документ блокирует весь набор', all.blocked === true);
  ok('в отчёте видно, какой именно документ', all.rows.find((r) => r.doc === 'b.md').status === 'INVERTED');
  ok('чистый документ рядом остаётся ок', all.rows.find((r) => r.doc === 'a.md').status === 'ok');
  ok('отсутствующий файл не роняет проверку', judgeAll(['x.md'], () => null, {}).rows[0].status === 'missing');
  ok('пустой реестр не блокирует, а сообщает', judgeAll(docs, read, {}).blocked === false);

  if (fails) { console.log(`\n\x1b[31ml0-content-guard self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ l0-content-guard: перевёрнутая норма при неизменной версии блокирует; поправка с версией проходит\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('l0-content-guard.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = argv.indexOf(k); return i !== -1 ? argv[i + 1] : null; };
  const docsArg = arg('--docs');
  const docs = docsArg ? docsArg.split(',').map((s) => s.trim()).filter(Boolean) : L0_NORMATIVE_DOCS;
  const readDoc = (rel) => { try { return readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
  let registry = {};
  try { registry = JSON.parse(readFileSync(REGISTRY, 'utf8')); } catch { /* first run */ }

  if (argv.includes('--stamp')) {
    const reason = arg('--reason');
    if (!reason) { console.error('отказ: --stamp требует --reason. Перештамповка без причины это то же самое, что её отсутствие.'); process.exit(2); }
    const next = { ...registry };
    const changed = [];
    for (const rel of docs) {
      const c = readDoc(rel);
      if (c === null) continue;
      const fp = fingerprint(c);
      if (!next[rel] || next[rel].fingerprint !== fp) changed.push(rel);
      next[rel] = { fingerprint: fp, version: declaredVersion(c), stampedAt: new Date().toISOString().slice(0, 10) };
    }
    mkdirSync(path.dirname(REGISTRY), { recursive: true });
    writeFileSync(REGISTRY, `${JSON.stringify(next, null, 2)}\n`);
    appendFileSync(AUDIT, `${JSON.stringify({ at: new Date().toISOString(), reason, changed })}\n`);
    console.log(`l0-content-guard: записано ${docs.length} документ(ов), из них изменилось ${changed.length}${changed.length ? `: ${changed.join(', ')}` : ''}`);
    console.log(`  причина записана в ${path.relative(ROOT, AUDIT)}`);
    process.exit(0);
  }

  const { rows, blocked } = judgeAll(docs, readDoc, registry);
  for (const r of rows) {
    const mark = r.status === 'INVERTED' ? '\x1b[31m✗\x1b[0m' : r.status === 'ok' ? '\x1b[32m✓\x1b[0m' : '\x1b[33m○\x1b[0m';
    console.log(`  ${mark} ${r.doc.padEnd(24)} ${r.status}${r.why ? ` — ${r.why}` : ''}`);
  }
  if (blocked) {
    console.error('\n\x1b[31ml0-content-guard: норма изменена без объявления поправки.\x1b[0m');
    console.error('  Если правка намеренная, подними version в документе, потом:');
    console.error('    node scripts/l0-content-guard.mjs --stamp --reason "<что и почему меняется>"');
    process.exit(1);
  }
  const unstamped = rows.filter((r) => r.status === 'unstamped').length;
  if (unstamped) console.log(`\n  ${unstamped} документ(ов) ещё не под проверкой — застолбить: --stamp --reason "..."`);
  else console.log('\n\x1b[32m✓ нормативные документы совпадают с записанным содержанием\x1b[0m');
  process.exit(0);
}
