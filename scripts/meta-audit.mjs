#!/usr/bin/env node
// @scope: all
// @scope-ok: рецидив виден только на всей истории классов, 0,09 с
// Meta-Mistake Engine — the system that improves itself.
//
// Reads a ledger of PROCESS mistakes (things a human or a check caught that the
// orchestrator missed), detects RECURRING classes, and for any class that
// repeats it demands an architectural fix — a GATE, not another patch — and
// emits a concrete remedy. The premise: a repeated miss is not bad luck, it is
// a missing mechanism. The engine turns recurrence into a required gate.
//
// CLOSED LOOP: every gate carries its activation date. The engine then checks
// whether the class recurred AFTER the gate went live. Three states result:
//   🟢 holding    — gate live, zero recurrences since → does NOT block (loop closed)
//   🔴 regression — recurred after the gate → the gate leaked; outranks fresh recurrence
//   ⚠ ungated     — recurring with no gate yet → build the mechanism
// Without the date the loop is open: you can't tell "still broken" from "now fixed",
// and a leaky gate hides forever. The date is what makes the learning measurable.
//
// This is deliberately executable, not a document: the lesson it encodes is
// exactly "documents don't enforce; mechanisms do."
//
// Usage:
//   node scripts/meta-audit.mjs            # analyze, exit 1 if a class recurs
//   node scripts/meta-log.mjs ...          # append a mistake to the ledger

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { loadLedgerUnion, groupByClass, daysBetween, todayISO, recurrencesAfter } from './meta-lib.mjs';
import { REMEDIES } from './meta-remedies.mjs'; // single source of truth for gates
import { fileURLToPath } from 'node:url';

/**
 * 2026-W35-A1 — ВТОРАЯ ОСЬ РЕЦИДИВА: по режиму отказа, а не по имени класса.
 *
 * Замер по живому реестру 2026-08-24. Детектор по имени класса нашёл в августе НОЛЬ
 * повторов. Тот же август по режиму отказа: FM-3.3 («оракул мерит не ту величину»)
 * повторился 14 раз за 25 дней под ЧЕТЫРНАДЦАТЬЮ разными именами, FM-3.2 — 8 раз под
 * восемью. Вместе это 52 инцидента из 84 за всю историю.
 *
 * Причина слепоты арифметическая: 63 класса из 71 (89%) встречались ровно один раз.
 * Детектор, который срабатывает на ВТОРОМ появлении ИМЕНИ, по построению не видит 89%
 * своего поля. А строка `gate coverage 100% (9/9 recurring classes gated)` считает
 * знаменателем девять рецидивных имён из семидесяти одного класса, то есть 13% поля,
 * и печатает по нему сто процентов.
 *
 * Поле mastMode обязательно с 2026-08-18 и заполнено у 100% записей. До этой правки оно
 * не влияло НИ НА ОДНО решение: meta-audit не упоминал его вовсе, meta-trend считал
 * только заполненность. Вторая ось существовала как данные и отсутствовала как прибор.
 *
 * Порог — три РАЗНЫХ имени класса в скользящем окне. Три, а не два: два имени одного
 * режима бывают совпадением, а три подряд это уже способ, которым мы ошибаемся.
 * Повтор ОДНОГО имени семьёй не считается — его ловит детектор по имени, и дублировать
 * сигнал значит удваивать один и тот же счётчик.
 *
 * @param {Array<object>} ledgerRows
 * @param {{windowDays?:number, minDistinctClasses?:number}} [opts]
 * @returns {Array<{mode:string, peak:number, window:{from:string,to:string},
 *                  classes:string[], total:number}>}
 */
export function recurrenceByMode(ledgerRows = [], opts = {}) {
  const windowDays = opts.windowDays ?? 30;
  const minDistinct = opts.minDistinctClasses ?? 3;
  const byMode = new Map();
  for (const r of ledgerRows) {
    const mode = r && r.mastMode;
    const date = r && (r.date || r.ts || '').slice(0, 10);
    // null — законный ответ «режим рассмотрен и не подошёл», и семьи он не образует:
    // «ни один режим не подошёл» это не общий способ ошибаться, это его отсутствие.
    if (!mode || !date || !r.class) continue;
    if (!byMode.has(mode)) byMode.set(mode, []);
    byMode.get(mode).push({ date, cls: r.class });
  }
  const out = [];
  for (const [mode, items] of byMode) {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    let best = null;
    for (let i = 0; i < sorted.length; i++) {
      const seen = new Set();
      let end = sorted[i].date;
      for (let j = i; j < sorted.length; j++) {
        if (daysBetween(sorted[i].date, sorted[j].date) > windowDays) break;
        seen.add(sorted[j].cls);
        end = sorted[j].date;
      }
      if (!best || seen.size > best.peak) best = { peak: seen.size, from: sorted[i].date, to: end, classes: [...seen] };
    }
    if (best && best.peak >= minDistinct) {
      out.push({ mode, peak: best.peak, window: { from: best.from, to: best.to }, classes: best.classes, total: sorted.length });
    }
  }
  return out.sort((a, b) => b.peak - a.peak);
}

/**
 * 2026-W35-A1 — покрытие механизмами по РЕЖИМУ: сколько разных имён этого режима имеют
 * запись в реестре средств. Печатается рядом с покрытием по именам, потому что одна
 * цифра под двумя смыслами это ровно тот дефект, который здесь и лечится.
 * @param {Array<object>} ledgerRows
 * @param {Record<string, unknown>} remedies
 */
export function modeCoverage(ledgerRows = [], remedies = {}) {
  const byMode = new Map();
  for (const r of ledgerRows) {
    if (!r || !r.mastMode || !r.class) continue;
    if (!byMode.has(r.mastMode)) byMode.set(r.mastMode, new Set());
    byMode.get(r.mastMode).add(r.class);
  }
  const out = [];
  for (const [mode, classes] of byMode) {
    const gated = [...classes].filter((c) => Object.prototype.hasOwnProperty.call(remedies, c)).length;
    out.push({ mode, classes: classes.size, gated, pct: Math.round((100 * gated) / (classes.size || 1)) });
  }
  return out.sort((a, b) => b.classes - a.classes);
}

const rows = loadLedgerUnion(); // union-ledger-read: both addresses, deduped (2026-W32-R2)

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  if (rows.length === 0) { console.log('meta-audit: ledger empty — nothing to analyze.'); process.exit(0); }

  const grouped = groupByClass(rows);
  // normalized-class-key: no merge is silent. Print every spelling folded into another.
  if (grouped.mergedPairs && grouped.mergedPairs.length) {
    console.log("\n  class spellings merged (normalized-class-key):");
    for (const p of grouped.mergedPairs) console.log(`    ${p.folded} -> ${p.into}`);
  }
  const classes = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);
  console.log(`meta-audit: ${rows.length} logged mistakes across ${classes.length} class(es)\n`);

  const today = todayISO();
  const QUARANTINE_DAYS = 14; // days a gate must hold with zero recurrences before we trust it
  const incident = it => `    · ${it.date}: claimed "${it.claimed}"\n        → reality: ${it.real} [caught by ${it.caught_by}]`;

  let ungated = 0, regressed = 0, holding = 0, brokenGate = 0, externalGate = 0;

  for (const [cls, items] of classes) {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const remedy = REMEDIES[cls];
    const recurring = items.length >= 2;
    const after = recurrencesAfter(items, remedy?.since); // strictly-after = recurrence through the gate

    // Регрессия, уже закрытая усилением, — не то же самое, что открытая.
    // Поле `strengthened` называет дату, когда механизм был УСИЛЕН после утечки.
    // Повторы ДО этой даты относятся к старому механизму: они остаются видимыми
    // (историю не стираем), но не держат счётчик открытым вечно. Повтор ПОСЛЕ
    // усиления снова красный — значит и усиление не удержало.
    const послеУсиления = remedy?.strengthened
      ? recurrencesAfter(items, remedy.strengthened)
      : after;

    if (remedy?.since && after.length > 0 && послеУсиления.length === 0 && remedy?.strengthened) {
      holding++;
      console.log(`\x1b[33m◐ REGRESSION CLOSED: ${cls}\x1b[0m`);
      console.log(`    ${after.length}× протекло при механизме от ${remedy.since}; усилено ${remedy.strengthened}`);
      for (const it of after) console.log(incident(it));
      console.log(`    mechanism: ${remedy.mechanism}`);
      console.log(`  \x1b[33m→ повторов после усиления нет. Вернётся в красное при первом же новом.\x1b[0m\n`);
    } else if (remedy?.since && after.length > 0) {
      // The gate existed and the class recurred anyway. Worst signal: not bad luck, a leaky gate.
      regressed++;
      console.log(`\x1b[31m🔴 REGRESSION (${after.length}× after gate): ${cls}\x1b[0m`);
      console.log(`    gate live since ${remedy.since} (${remedy.mechanism ?? 'documented-only'}), yet recurred:`);
      for (const it of after) console.log(incident(it));
      console.log(`  \x1b[31m→ The gate did NOT hold. Do not re-document — STRENGTHEN THE MECHANISM or add a stricter gate.`);
      console.log(`    A gate that leaks is a design defect; this outranks fresh recurrence.\x1b[0m\n`);
    } else if (recurring && !remedy) {
      // Recurring with no gate yet — build the mechanism.
      ungated++;
      console.log(`\x1b[33m⚠ RECURRING (${items.length}×, ungated): ${cls}\x1b[0m`);
      for (const it of sorted) console.log(incident(it));
      console.log(`  \x1b[36m→ REMEDY (gate, not patch):\x1b[0m NO GATE REGISTERED. This class recurred without a known gate —`);
      console.log(`    build a mechanism for it and register it (with its activation date) in REMEDIES.\n`);
    } else if (recurring && remedy) {
      // Was recurring; gate is in place; zero recurrences strictly after it — the loop is closing.
      holding++;
      const age = daysBetween(remedy.since, today);
      const verdict = age >= QUARANTINE_DAYS
        ? `held ${age}d through quarantine`
        : `under watch (${QUARANTINE_DAYS - age}d to clear)`;
      console.log(`\x1b[32m🟢 GATED — holding: ${cls}\x1b[0m`);
      console.log(`    ${items.length} past incident(s), gate live since ${remedy.since}, 0 recurrences after — ${verdict}.`);
      console.log(`    mechanism: ${remedy.mechanism ?? '\x1b[33m(none — documented gate only, weaker)\x1b[0m'}\n`);
    }

    // Self-consistency: the engine must not itself declare a gate it can't point to.
    // (This is the declaration-over-implementation class applied to the engine's own claims.)
    // Mechanism paths may carry a {HOME} placeholder (portable remedy entries) — expand
    // it before the existence check, otherwise a real gate reads as a broken one.
    // У класса законно бывает НЕСКОЛЬКО механизмов: один ловит одно, второй —
    // другое. Раньше поле читалось как один путь целиком, поэтому запись вида
    // "a.mjs + b.mjs" объявлялась сломанной, хотя оба файла на месте (поймано
    // 2026-08-11 при усилении declaration-over-implementation).
    //
    // Отдельно различается ВНЕШНИЙ механизм: гейт, живущий в продуктовом
    // репозитории, а не здесь. Он существует, просто отсюда не виден — звать
    // его сломанным нечестно, а молчать нельзя, потому что фреймворк его не
    // раздаёт. Поэтому у него свой счётчик и своя строка.
    const пути = (remedy?.mechanism ?? '')
      .split('+')
      .map((ч) => ч.trim().replace(/\s*\(.*\)$/, '').replace('{HOME}', homedir()))
      .filter(Boolean);

    for (const mech of пути) {
      const внешний = !mech.startsWith('/') && mech.includes('/') && !existsSync(mech) && /^[\w.-]+\//.test(mech) && !mech.startsWith('scripts/') && !mech.startsWith('hooks/');
      if (внешний) {
        externalGate++;
        console.log(`\x1b[33m  ↗ gate for "${cls}" lives outside this repo: ${mech}`);
        console.log(`     it exists there, but the framework does not ship it — generalise or note it.\x1b[0m\n`);
        continue;
      }
      if (!existsSync(mech)) {
        brokenGate++;
        console.log(`\x1b[31m  ‼ gate for "${cls}" names ${mech}, but that file does not exist —`);
        console.log(`     the gate is a claim, not a mechanism. Build it or null the mechanism field.\x1b[0m\n`);
      }
    }
  }

  // ── вторая ось: рецидив по РЕЖИМУ ОТКАЗА (2026-W35-A1) ────────────────────
  // Всё выше считает повтор ИМЕНИ класса. Но мы переименовываем отказ почти каждый раз:
  // 89% классов встречались ровно один раз, поэтому счётчик по имени показывает ноль там,
  // где один и тот же способ ошибаться повторился десяток раз под разными названиями.
  const families = recurrenceByMode(rows);
  if (families.length) {
    console.log('\n\x1b[1m▌ Семейный рецидив — один РЕЖИМ отказа под разными именами\x1b[0m');
    for (const f of families) {
      const cov = modeCoverage(rows, REMEDIES).find((c) => c.mode === f.mode);
      console.log(`\x1b[33m⚠ ${f.mode}: ${f.peak} разных имён класса за 30 дней (${f.window.from} … ${f.window.to})\x1b[0m`);
      console.log(`    ${f.classes.join(', ')}`);
      if (cov) console.log(`    механизмы по этому режиму: ${cov.gated} из ${cov.classes} имён (${cov.pct}%)`);
      console.log('    \x1b[36m→ лечить надо РЕЖИМ, а не каждое имя по отдельности:\x1b[0m один механизм закрывает семью.');
    }
  }

  console.log('\n\x1b[1m— meta-audit summary —\x1b[0m');
  console.log(`  gated & holding: ${holding}    ungated recurring: ${ungated}    regressions: ${regressed}    broken gates: ${brokenGate}    external: ${externalGate}`);
  // ДВА числа, и никогда одно: «по имени 0 повторов» и «по режиму 2 семьи» это правда
  // об одних и тех же данных, и вторая половина важнее.
  console.log(`  семейных рецидивов по режиму отказа: ${families.length}${families.length ? ' (' + families.map((f) => `${f.mode}×${f.peak}`).join(', ') + ')' : ''}`);

  // Семья НЕ блокирует: порог выбран впервые и не откалиброван на истории, а гейт,
  // который блокирует по неоткалиброванному порогу, учат обходить. Сначала пусть
  // печатает и накопит основания, потом решаем про блокировку.
  const blocking = ungated + regressed + brokenGate;
  if (regressed > 0)
    console.log(`\n\x1b[31m${regressed} regression(s): a gate that was supposed to hold did not. Fix the mechanism before anything else.\x1b[0m`);
  if (brokenGate > 0)
    console.log(`\n\x1b[31m${brokenGate} broken gate(s): a remedy names a mechanism that isn't on disk.\x1b[0m`);
  if (ungated > 0)
    console.log(`\n${ungated} ungated recurring class(es). A repeated miss = a missing mechanism. Build the gate.`);

  if (blocking > 0) process.exit(1); // architectural work required, do not ignore
  console.log('\n\x1b[32m✓ no ungated recurrences, no regressions — every recurring class has a gate that is holding.\x1b[0m');
  process.exit(0);
}
