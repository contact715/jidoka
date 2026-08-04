#!/usr/bin/env node
/**
 * synthesis-coverage-audit — механическая проверка покрытия документа-синтеза.
 *
 * Проблема, которую закрывает (класс `synthesis-shipped-without-coverage-audit`):
 * ТЗ, смета, коммерческое предложение, итоги брифа — это выжимки из источников
 * (транскрипт созвона, переписка, анкета, документация). Автор держит источники
 * "в голове" и сдаёт документ, не сверив его с ними. Пропуски находит заказчик,
 * а не автор.
 *
 * Что делает: извлекает из источников значимые сущности (имена собственные, суммы,
 * проценты, названия продуктов, термины в кавычках, повторяющиеся понятия) и
 * проверяет, встречается ли каждая в документе. Выдаёт список непокрытого,
 * отсортированный по частоте упоминания в источниках: чем чаще говорили, тем
 * важнее пропуск.
 *
 * Это НЕ замена человеческому чтению. Это сеть, которая ловит крупные дыры
 * до того, как их найдёт клиент.
 *
 * Использование:
 *   node synthesis-coverage-audit.mjs --doc ТЗ.md --sources ./sources/
 *   node synthesis-coverage-audit.mjs --doc ТЗ.md --sources a.md,b.txt --json
 *   node synthesis-coverage-audit.mjs --self-test
 */
import fs from "node:fs";
import path from "node:path";

// ---------- нормализация ----------

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Слова, которые никогда не считаем значимыми сущностями.
const STOP = new Set([
  // русские служебные
  "это","что","как","для","при","над","под","про","без","или","они","она","оно","его","ему","них",
  "мы","вы","ты","он","их","там","тут","где","чем","чтобы","если","когда","уже","еще","ещё","так",
  "все","всё","весь","вся","этот","эта","эти","тот","та","те","был","была","было","были","есть",
  "нет","да","не","ни","но","и","а","в","с","к","о","у","на","по","за","из","до","от","же","бы",
  "надо","нужно","можно","нельзя","будет","будут","может","могут","должен","должна","должно",
  "очень","более","менее","самый","самая","более","только","также","тоже","почему","потому",
  "который","которая","которые","которое","свой","своя","свои","наш","наша","наши","ваш","ваша",
  "один","два","три","раз","года","году","лет","день","дня","дней","час","часа","часов",
  // английские служебные
  "the","and","for","with","that","this","from","are","was","were","have","has","had","not","but",
  "you","your","our","its","their","they","them","can","will","would","should","could","may","might",
  "all","any","some","more","most","other","such","than","then","there","here","what","which","who",
  "when","where","how","why","also","very","just","only","into","over","under","about","after",
]);

// ---------- извлечение сущностей ----------

/**
 * Из текста источников достаём кандидатов в значимые сущности.
 * Каждый кандидат: { term, kind, count, sample }
 */
export function extractEntities(text) {
  const found = new Map(); // normalized -> {term, kind, count, sample}

  const add = (term, kind, sample) => {
    const key = normalize(term);
    if (!key || key.length < 3) return;
    if (STOP.has(key)) return;
    if (/^\d+$/.test(key)) return; // голое число без единиц
    const prev = found.get(key);
    if (prev) {
      prev.count += 1;
      return;
    }
    found.set(key, { term: term.trim(), kind, count: 1, sample: (sample || "").trim().slice(0, 120) });
  };

  const lines = String(text || "").split(/\n/);

  for (const line of lines) {
    // 1. Денежные суммы: $3,000 / 250 долларов / 2 процента
    for (const m of line.matchAll(/\$\s?[\d][\d\s,.]*\d|\d[\d\s,.]*\s?(?:доллар\w*|процент\w*|%)/gi)) {
      add(m[0], "сумма", line);
    }

    // 2. Латинские имена собственные и продукты: Boulevard, NakedMD, Instagram, Vagaro
    for (const m of line.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)*\b/g)) {
      const w = m[0];
      if (w.length < 3) continue;
      if (/^(The|And|For|This|That|With|From|Not|But|You|Your|Our|All|Any)$/i.test(w)) continue;
      add(w, "название", line);
    }

    // 3. Термины в кавычках (прямая речь клиента, важные формулировки)
    for (const m of line.matchAll(/[«"]([^«»"]{4,60})[»"]/g)) {
      add(m[1], "цитата", line);
    }

    // 4. Кириллические слова с заглавной не в начале предложения (имена, бренды)
    for (const m of line.matchAll(/(?<![.!?]\s)(?<!^)\b[А-ЯЁ][а-яё]{3,}\b/gm)) {
      add(m[0], "имя", line);
    }
  }

  return [...found.values()];
}

// ---------- проверка покрытия ----------

export function checkCoverage(entities, docText) {
  const doc = normalize(docText);
  const covered = [];
  const missing = [];

  for (const e of entities) {
    const key = normalize(e.term);
    // ищем и целиком, и по корню (для русских словоформ берём первые 60% слова)
    const stem = key.length > 5 ? key.slice(0, Math.max(4, Math.floor(key.length * 0.7))) : key;
    if (doc.includes(key) || doc.includes(stem)) covered.push(e);
    else missing.push(e);
  }

  missing.sort((a, b) => b.count - a.count);
  return { covered, missing };
}

// ---------- сбор источников ----------

function readSources(spec) {
  const files = [];
  for (const item of String(spec).split(",")) {
    const p = item.trim();
    if (!p) continue;
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        if (/\.(md|txt|json|html)$/i.test(f)) files.push(path.join(p, f));
      }
    } else {
      files.push(p);
    }
  }
  return files;
}

// ---------- self-test ----------

function selfTest() {
  const checks = [];
  const ok = (name, cond) => checks.push({ name, pass: !!cond });

  // нормализация
  ok("normalize сводит ё к е", normalize("Ещё") === "еще");
  ok("normalize убирает кавычки", normalize('«Boulevard»') === "boulevard");

  // извлечение
  const src = `
    Клиент сказал: «нам надо слизать все устройства».
    Стоимость 3 000 долларов, комиссия 2 процента.
    Работаем через Boulevard, раньше был Vagaro.
    Медицинский директор Mayra ведёт процедуры.
  `;
  const ents = extractEntities(src);
  const terms = ents.map((e) => normalize(e.term));
  ok("находит название Boulevard", terms.includes("boulevard"));
  ok("находит название Vagaro", terms.includes("vagaro"));
  ok("находит сумму в долларах", terms.some((t) => t.includes("доллар")));
  ok("находит проценты", terms.some((t) => t.includes("процент")));
  ok("находит цитату клиента", terms.some((t) => t.includes("слизать")));
  ok("не тащит служебные слова", !terms.includes("что") && !terms.includes("для"));

  // покрытие
  const doc = "Работаем через Boulevard. Стоимость 3 000 долларов.";
  const { covered, missing } = checkCoverage(ents, doc);
  ok("Boulevard засчитан как покрытый", covered.some((e) => normalize(e.term) === "boulevard"));
  ok("Vagaro отмечен как пропущенный", missing.some((e) => normalize(e.term) === "vagaro"));
  ok("пропуски отсортированы по частоте", missing.every((e, i, a) => i === 0 || a[i - 1].count >= e.count));

  // пустые входы не роняют
  ok("пустой источник не падает", extractEntities("").length === 0);
  ok("пустой документ не падает", checkCoverage([], "").missing.length === 0);

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`${c.pass ? "  ok  " : " FAIL "} ${c.name}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exit(failed.length ? 1 : 0);
}

// ---------- CLI ----------

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();

  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };

  const docPath = get("--doc");
  const sourcesSpec = get("--sources");
  const asJson = argv.includes("--json");
  const limit = Number(get("--limit") || 40);

  if (!docPath || !sourcesSpec) {
    console.error("использование: --doc <файл> --sources <файлы через запятую или папка> [--json] [--limit N]");
    process.exit(1);
  }

  let docText = "";
  try {
    docText = fs.readFileSync(docPath, "utf8");
  } catch (e) {
    console.error(`не читается документ: ${docPath}`);
    process.exit(1);
  }

  const files = readSources(sourcesSpec);
  if (!files.length) {
    console.error("источники не найдены");
    process.exit(1);
  }

  let sourceText = "";
  for (const f of files) {
    try {
      sourceText += "\n" + fs.readFileSync(f, "utf8");
    } catch {}
  }

  const entities = extractEntities(sourceText);
  const { covered, missing } = checkCoverage(entities, docText);
  const total = entities.length;
  const pct = total ? Math.round((covered.length / total) * 100) : 100;

  if (asJson) {
    console.log(JSON.stringify({ total, covered: covered.length, missing: missing.slice(0, limit) }, null, 2));
    return;
  }

  console.log(`\nПокрытие: ${covered.length} из ${total} сущностей (${pct}%)`);
  console.log(`Источники: ${files.length} файлов\n`);

  if (!missing.length) {
    console.log("Непокрытых сущностей не найдено.");
    return;
  }

  console.log(`Не найдено в документе (по убыванию частоты в источниках), топ ${Math.min(limit, missing.length)}:\n`);
  for (const m of missing.slice(0, limit)) {
    console.log(`  ${String(m.count).padStart(3)}×  [${m.kind}] ${m.term}`);
    if (m.sample) console.log(`        контекст: ${m.sample}`);
  }
  console.log(`\nЭто кандидаты на пропуск. Каждый проверить глазами: относится к теме или шум.`);
}

main();
