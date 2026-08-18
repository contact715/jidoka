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
import { fileURLToPath } from 'node:url';

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

// ---------- полнота по ТИПУ СДАЧИ ----------
//
// Замер 2026-08-17 (недельный прогон W34). Поиск по журналу сессий на строку «ты точно»
// дал ОДИННАДЦАТЬ разных сессий за август, в пяти проектах. Под опознавание
// документа-синтеза (расширение файла плюс имя) попадает примерно один случай из
// одиннадцати. Остальные десять этот инструмент не мог проверить по построению, потому
// что сдача была не документом:
//   «так ты точно все применил в инбоксе с фигмы? все стили и spatial?»  → перенос дизайна
//   «Ты точно скачал весь бэк-энд на компьютер? Всё скачал?»              → перенос чужого кода
//   «Ты точно в этом плане всё покрыл? Все сценарии, исходы, кнопки»      → план в переписке
//   «ты точно все нашел, чтобы звук был неотличим»                        → ресёрч под качество
//
// Берём ДВА типа, у которых источник истины механически сверяем, и не берём два, у которых
// он живёт в переписке. Это осознанный недобор: гейт, у которого нет исполнимого лечения,
// блокирует работу и не даёт способа разблокироваться — ровно тот тупик, который движок
// поймал на себе в этот же день (класс gate-remedy-cannot-satisfy-the-gate).

/** Типы сдачи, у которых полнота проверяема машиной. */
export const AUDITABLE_KINDS = new Set(['doc-synthesis', 'design-port', 'code-import']);

const SKIP_DIR = /(^|\/)(\.git|node_modules|\.next|dist|build|\.turbo|coverage|__pycache__|\.venv)(\/|$)/;

/** Рекурсивный список путей относительно корня. Отсортирован, поэтому сравним. */
export function listFiles(root, read = fs.readdirSync, stat = fs.statSync, base = root, out = []) {
  let entries = [];
  try { entries = read(root); } catch { return out; }
  for (const e of entries) {
    const abs = path.join(root, e);
    const rel = path.relative(base, abs);
    if (SKIP_DIR.test(rel)) continue;
    let st;
    try { st = stat(abs); } catch { continue; }
    if (st.isDirectory()) listFiles(abs, read, stat, base, out);
    else out.push(rel);
  }
  return out.sort();
}

/**
 * Разница множеств файлов: что есть в источнике и НЕ доехало в цель. Пустая.
 * Именно этот вопрос стоит за «ты точно скачал весь бэкенд?».
 */
export function fileSetDiff(sourceList = [], targetList = []) {
  const have = new Set(targetList);
  const missing = sourceList.filter((f) => !have.has(f));
  const extra = targetList.filter((f) => !new Set(sourceList).has(f));
  return { missing, extra, total: sourceList.length, covered: sourceList.length - missing.length };
}

/**
 * Полнота сдачи по типу. Пустая: на вход подаётся уже прочитанный текст либо списки путей.
 *
 * doc-synthesis — сущности источника против текста документа (прежнее поведение);
 * design-port   — сущности инвентаря дизайна (токены, названия стилей и слоёв) против
 *                 текста ИЗМЕНЁННОГО КОДА, потому что «применил ли ты стили» это вопрос
 *                 о коде, а не о документе;
 * code-import   — разница множеств файлов, без извлечения сущностей: у переноса чужого
 *                 кода полнота измеряется файлами, а не словами.
 */
export function auditByKind({ kind, sourceText = '', targetText = '', sourceList = null, targetList = null } = {}) {
  if (!AUDITABLE_KINDS.has(kind)) {
    return { kind, auditable: false, reason: `тип "${kind}" не проверяется машиной — источник истины живёт в переписке`, missing: [], total: 0 };
  }
  if (kind === 'code-import') {
    if (!sourceList || !targetList) return { kind, auditable: false, reason: 'нужны списки файлов источника и цели', missing: [], total: 0 };
    const d = fileSetDiff(sourceList, targetList);
    return { kind, auditable: true, missing: d.missing.map((f) => ({ term: f, kind: 'файл', count: 1 })), total: d.total, covered: d.covered, extra: d.extra };
  }
  const entities = extractEntities(sourceText);
  const { covered, missing } = checkCoverage(entities, targetText);
  return { kind, auditable: true, missing, covered, total: entities.length };
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

  // ---- полнота по типу сдачи ----
  ok("известный тип проверяем", auditByKind({ kind: 'doc-synthesis', sourceText: 'Boulevard', targetText: 'Boulevard' }).auditable === true);
  ok("неизвестный тип честно объявлен непроверяемым", auditByKind({ kind: 'plan-in-chat' }).auditable === false);
  ok("непроверяемый тип называет причину", /переписке/.test(auditByKind({ kind: 'plan-in-chat' }).reason));

  // перенос дизайна: инвентарь против КОДА, а не против документа
  const design = auditByKind({ kind: 'design-port', sourceText: 'Градиент Aurora, отступ spacing-6, радиус radius-xl', targetText: 'className="rounded-xl gap-6"' });
  ok("перенос дизайна проверяем", design.auditable === true);
  ok("неперенесённый токен виден как пропуск", design.missing.some((m) => /aurora/i.test(m.term)));
  ok("перенесённый токен не считается пропуском", !design.missing.some((m) => /radius/i.test(m.term)));

  // перенос чужого кода: полнота меряется ФАЙЛАМИ
  const d = fileSetDiff(['a.js', 'src/b.js', 'src/c.js'], ['a.js', 'src/b.js']);
  ok("недоехавший файл виден", d.missing.length === 1 && d.missing[0] === 'src/c.js');
  ok("покрытие считается по файлам", d.covered === 2 && d.total === 3);
  ok("лишний файл в цели назван отдельно", fileSetDiff(['a.js'], ['a.js', 'x.js']).extra[0] === 'x.js');
  ok("полное совпадение не даёт пропусков", fileSetDiff(['a.js'], ['a.js']).missing.length === 0);
  ok("пустой источник не даёт ложных пропусков", fileSetDiff([], ['a.js']).missing.length === 0);
  const ci = auditByKind({ kind: 'code-import', sourceList: ['a', 'b'], targetList: ['a'] });
  ok("перенос кода отдаёт пропуски в общей форме", ci.missing[0].term === 'b' && ci.missing[0].kind === 'файл');
  ok("перенос кода без списков честно непроверяем", auditByKind({ kind: 'code-import' }).auditable === false);

  // обход дерева
  const fakeRead = (dir) => ({ '/r': ['a.js', 'node_modules', 'sub'], '/r/sub': ['b.js'], '/r/node_modules': ['junk.js'] })[dir] || [];
  const fakeStat = (p) => ({ isDirectory: () => p === '/r/sub' || p === '/r/node_modules' });
  const listed = listFiles('/r', fakeRead, fakeStat, '/r');
  ok("обход дерева находит вложенные файлы", listed.includes('sub/b.js'));
  ok("node_modules не попадает в список", !listed.some((f) => /node_modules/.test(f)));

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

  // Режим по ТИПУ СДАЧИ. Отдельная ветка, потому что у переноса кода полнота меряется
  // файлами, а не словами, и склеивать это с извлечением сущностей значило бы врать
  // одним числом про две разные величины.
  const kind = get("--kind");
  if (kind) {
    const src = get("--source");
    const tgt = get("--target");
    if (!src || !tgt) {
      console.error('использование: --kind <design-port|code-import|doc-synthesis> --source <файл|папка> --target <файл|папка> [--json]');
      process.exit(1);
    }
    const readAll = (spec) => readSources(spec).map((f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
    let res;
    if (kind === 'code-import') {
      const isDir = (p2) => { try { return fs.statSync(p2).isDirectory(); } catch { return false; } };
      if (!isDir(src) || !isDir(tgt)) { console.error('для code-import и --source, и --target должны быть папками'); process.exit(1); }
      res = auditByKind({ kind, sourceList: listFiles(src), targetList: listFiles(tgt) });
    } else {
      res = auditByKind({ kind, sourceText: readAll(src), targetText: readAll(tgt) });
    }
    if (asJson) { console.log(JSON.stringify(res, null, 2)); process.exit(0); }
    if (!res.auditable) { console.log(`\x1b[33m⚠ ${res.reason}\x1b[0m`); process.exit(0); }
    const pct = res.total ? Math.round(((res.total - res.missing.length) / res.total) * 100) : 100;
    console.log(`сверка «${kind}»: покрыто ${res.total - res.missing.length} из ${res.total} (${pct}%)`);
    if (!res.missing.length) { console.log('\x1b[32m✓ непокрытого не найдено\x1b[0m'); process.exit(0); }
    console.log(`\n\x1b[33mНЕ доехало (${res.missing.length}), проверить глазами каждую строку:\x1b[0m`);
    for (const m of res.missing.slice(0, limit)) console.log(`  · ${m.term}${m.kind && m.kind !== 'файл' ? `  [${m.kind}]` : ''}`);
    if (res.missing.length > limit) console.log(`  … и ещё ${res.missing.length - limit}`);
    if (res.extra && res.extra.length) console.log(`\n  (в цели есть ${res.extra.length} файл(ов), которых нет в источнике — это нормально, если вы добавляли своё)`);
    process.exit(0);
  }

  if (!docPath || !sourcesSpec) {
    console.error("использование: --doc <файл> --sources <файлы через запятую или папка> [--json] [--limit N]");
    console.error("            либо: --kind <design-port|code-import> --source <файл|папка> --target <файл|папка>");
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


const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
