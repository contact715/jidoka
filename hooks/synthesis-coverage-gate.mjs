#!/usr/bin/env node
// @closes-class: synthesis-shipped-without-coverage-audit, completeness-claimed-without-self-audit
/**
 * synthesis-coverage-gate — Stop-хук против сдачи документа-синтеза без сверки с источниками.
 *
 * Класс в мета-леджере: `synthesis-shipped-without-coverage-audit`.
 *
 * Проблема. ТЗ, смета, коммерческое предложение, итоги брифа, аудит — это выжимки из
 * источников (транскрипт созвона, переписка, анкета, документация). Автор держит источники
 * "в голове", пишет документ и сдаёт его. Пропуски находит заказчик, а не автор.
 *
 * Почему прежнее правило не сработало. В CLAUDE.md есть правило "ресёрч не сдаётся без
 * собственного аудита покрытия". Но оно привязано к слову РЕСЁРЧ. Написание ТЗ автором
 * не классифицируется как ресёрч ("я просто оформляю то, что знаю"), поэтому правило
 * не срабатывает по категории. Этот хук привязан не к слову, а к ТИПУ АРТЕФАКТА.
 *
 * Поведение. На Stop смотрим, что сессия ДЕЛАЛА:
 *   если в сессии создан или изменён документ-синтез (по имени файла)
 *   и после этого НЕ запускался synthesis-coverage-audit.mjs
 *   → блокируем остановку ОДИН раз с инструкцией.
 *
 * Безопасность (тот же контракт, что у proof-of-work-gate):
 *   - Fail-open: любая ошибка, нет транскрипта → exit 0.
 *   - Блокировка не более одного раза за сессию (файл-маркер).
 *   - Уважает stop_hook_active, чтобы не зациклиться.
 *   - Точность важнее полноты: правки кода, конфигов и мелких заметок не триггерят.
 *
 * Использование:
 *   (как хук) читает Stop-payload JSON со stdin; exit 2 + stderr блокирует остановку.
 *   node synthesis-coverage-gate.mjs --self-test
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from 'node:url';
import { хвостТранскрипта } from "./lib/transcript-tail.mjs";

// Проверка кейса расхождения — исполняемая, не упоминание (--self-test-tail).
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--self-test-tail")) {
    // «древность отрезана (кейс расхождения)»: строка старше хвоста гейту не
    // видна — вход, где величина говорит «чисто», а правило нарушено в
    // древнем ходе. Принято осознанно: block-once, fail-open.
    const os = await import("node:os");
    const path = await import("node:path");
    const fsT = await import("node:fs");
    const tmp = path.join(os.tmpdir(), `tail-div-${process.pid}.jsonl`);
    fsT.writeFileSync(tmp, Array.from({ length: 500 }, (_, i) => JSON.stringify({ i })).join("\n"));
    const хвост = хвостТранскрипта(tmp, 200);
    const первая = JSON.parse(хвост.split("\n").filter(Boolean)[0]);
    fsT.unlinkSync(tmp);
    if (первая.i > 0) { console.log("✓ древность отрезана (кейс расхождения)"); process.exit(0); }
    console.error("FAIL: древность видна"); process.exit(1);
}


// @divergence: "древность отрезана (кейс расхождения)" — нарушение из хода старше 8-МБ хвоста гейт не увидит и скажет «чисто»; принято осознанно (block-once, fail-open, раньше древность терялась в таймауте), проверка живёт в lib/transcript-tail.mjs --self-test.

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function collectToolUses(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectToolUses(item, out);
    return;
  }
  if (node.type === "tool_use" && typeof node.name === "string") {
    out.push({ name: node.name, input: node.input || {} });
  }
  for (const key of Object.keys(node)) {
    if (key === "type") continue;
    collectToolUses(node[key], out);
  }
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * Документ-синтез: выжимка из внешних источников, которую читает заказчик или команда.
 * Опознаём по имени файла. Список намеренно узкий: precision over recall.
 */
export const SYNTHESIS_NAME = new RegExp(
  [
    "тз", "т-з", "техзадание", "техническое[-_ ]?задание",
    "смет", "estimate", "quote",
    "предложени", "proposal", "коммерческ",
    "итоги", "бриф", "brief", "debrief",
    "аудит", "audit",
    "анализ", "analysis",
    "спец", "spec(?!ial)",
    "требовани", "requirements",
    "план[-_ ]?работ", "roadmap",
  ].join("|"),
  "i"
);

const DOC_EXT = /\.(md|markdown|html|txt|docx?|pdf)$/i;
// Служебное и внутреннее, что синтезом не считается.
const NOT_SYNTHESIS = /(readme|changelog|license|contributing|node_modules|\.git\/|package(-lock)?\.json)/i;

export function isSynthesisDoc(filePath) {
  if (!filePath) return false;
  const p = String(filePath);
  if (NOT_SYNTHESIS.test(p)) return false;
  if (!DOC_EXT.test(p)) return false;
  const base = path.basename(p);
  return SYNTHESIS_NAME.test(base);
}

/** Механическая сверка: запуск инструмента покрытия. */
export function isCoverageAudit(tool) {
  if (tool.name !== "Bash") return false;
  const cmd = String(tool.input?.command || "");
  return /synthesis-coverage-audit/i.test(cmd);
}

/**
 * Смысловая сверка: субагент, читающий источники против документа.
 * Ловит то, что механика пропускает (клиент сказал X → следует требование Y).
 * Признак: вызов Agent/Task, в промпте которого есть и документ, и намерение сверки.
 */
export function isSemanticReview(tool) {
  if (!/^(Agent|Task)$/.test(tool.name)) return false;
  const text = JSON.stringify(tool.input || {}).toLowerCase();
  const mentionsSources = /источник|source|транскрипт|бриф|созвон/.test(text);
  const mentionsGap = /не отражен|непокрыт|пропуск|упущен|missing|not reflected|gap/.test(text);
  return mentionsSources && mentionsGap;
}

// ---------- ТИП СДАЧИ ----------
//
// Замер 2026-08-17: поиск по журналу сессий на «ты точно» дал 11 разных сессий за август в
// пяти проектах. Под опознавание документа-синтеза попадает ОДИН случай из одиннадцати:
// остальные десять были сдачей другого рода, и расширение файла про них ничего не знает.
//
// Берём два типа, у которых источник истины сверяем машиной, и НЕ берём два, у которых он
// живёт в переписке (план в чате, ресёрч под заданное качество). Это осознанный недобор:
// гейт, у которого нет исполнимого лечения, блокирует работу и не даёт способа
// разблокироваться. Движок поймал ровно такой тупик на себе в этот же день
// (класс gate-remedy-cannot-satisfy-the-gate), и повторять его здесь нельзя.
//
// Точность важнее полноты и внутри самих правил: одна правка после открытия макета это не
// перенос дизайна, поэтому нужен порог. Ложная блокировка учит обходу быстрее, чем
// пропущенный случай учит внимательности.

/** Инструменты, дающие ИСТОЧНИК дизайна: макет, токены, снимок экрана макета. */
export function isDesignSource(tool) {
  return /figma|design_context|get_variable_defs|get_screenshot|get_design/i.test(String(tool.name || ''));
}

const UI_FILE = /\.(tsx|jsx|vue|svelte|css|scss|sass|less)$/i;

/**
 * Строка команды без КАВЫЧЕК и комментариев. Пустая.
 *
 * Против класса `guard-fires-on-mention-not-action` (2026-08-08): сторож разрешений уже
 * блокировал собственный коммит, потому что запрещённый флаг встретился ВНУТРИ текста
 * сообщения. Тот же капкан здесь: `echo "сначала git clone, потом..."` это рассказ о
 * команде, а не команда. Смотрим на синтаксис, а не на вхождение подстроки.
 */
export function commandSkeleton(cmd = '') {
  return String(cmd)
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/#.*$/gm, '');
}

/** Перенос ЧУЖОГО кода к себе: клон, скачивание архива, копирование дерева. */
export function isCodeImport(tool) {
  if (tool.name !== 'Bash') return false;
  const cmd = commandSkeleton(tool.input?.command || '');
  if (/\bgit\s+clone\b/.test(cmd)) return true;
  if (/\bgh\s+repo\s+clone\b/.test(cmd)) return true;
  if (/\bdegit\b|\bsvn\s+checkout\b/.test(cmd)) return true;
  if (/\bscp\s+-r\b|\brsync\s+-[a-z]*a/.test(cmd)) return true;
  if (/\bcurl\b.*-[oO]\b.*\.(zip|tar\.gz|tgz)\b/.test(cmd)) return true;
  return false;
}

/** Сверка по типу: тот же инструмент, что и для документов, но в режиме --kind. */
export function isKindAudit(tool, kind) {
  if (tool.name !== 'Bash') return false;
  const cmd = String(tool.input?.command || '');
  return /synthesis-coverage-audit/i.test(cmd) && new RegExp(`--kind[= ]${kind}`).test(cmd);
}

/** Сколько правок UI-файлов нужно, чтобы считать это переносом дизайна, а не точечной правкой. */
export const DESIGN_PORT_MIN_EDITS = 2;

/**
 * Какие типы сдачи произошли в сессии и когда в последний раз. Пустая.
 * Возвращает [{kind, lastIdx, evidence}].
 */
export function deliverableKind(tools = []) {
  const out = [];

  // перенос дизайна: сначала открыли источник, ПОТОМ правили интерфейс (порядок важен —
  // открыть макет после правки это проверка, а не перенос)
  const firstDesignIdx = tools.findIndex(isDesignSource);
  if (firstDesignIdx >= 0) {
    const uiEdits = [];
    tools.forEach((t, i) => {
      if (i <= firstDesignIdx || !EDIT_TOOLS.has(t.name)) return;
      const fp = String(t.input?.file_path || '');
      if (UI_FILE.test(fp)) uiEdits.push(i);
    });
    if (uiEdits.length >= DESIGN_PORT_MIN_EDITS) {
      out.push({ kind: 'design-port', lastIdx: uiEdits[uiEdits.length - 1], evidence: `${uiEdits.length} правок интерфейса после открытия макета` });
    }
  }

  // перенос чужого кода
  let lastImport = -1;
  tools.forEach((t, i) => { if (isCodeImport(t)) lastImport = i; });
  if (lastImport >= 0) out.push({ kind: 'code-import', lastIdx: lastImport, evidence: 'скачивание чужого дерева кода' });

  return out;
}

/**
 * Главное решение: писали синтез и не сверяли его после этого?
 *
 * Сверка засчитывается, если после последней правки документа была хотя бы ОДНА из двух:
 *  - механическая (synthesis-coverage-audit): ловит пропавшие сущности
 *  - смысловая (субагент против источников): ловит пропавшие следствия
 *
 * Требовать обе жёстко нельзя: на коротком документе смысловая избыточна, и гейт,
 * который срабатывает всегда, начинают обходить. Поэтому одна обязательна, вторая
 * рекомендуется в тексте блокировки.
 *
 * Возвращает { shouldBlock, docs, hadMechanical, hadSemantic }.
 */
export function decide(tools) {
  let lastSynthesisIdx = -1;
  const docs = new Set();

  tools.forEach((t, i) => {
    if (!EDIT_TOOLS.has(t.name)) return;
    const fp = t.input?.file_path || t.input?.notebook_path || "";
    if (isSynthesisDoc(fp)) {
      lastSynthesisIdx = i;
      docs.add(path.basename(String(fp)));
    }
  });

  if (lastSynthesisIdx < 0) {
    return { shouldBlock: false, docs: [], hadMechanical: false, hadSemantic: false };
  }

  const after = tools.slice(lastSynthesisIdx + 1);
  const hadMechanical = after.some(isCoverageAudit);
  const hadSemantic = after.some(isSemanticReview);

  return {
    shouldBlock: !hadMechanical && !hadSemantic,
    docs: [...docs],
    hadMechanical,
    hadSemantic,
  };
}

/**
 * Полное решение по ВСЕМ типам сдачи, а не только по документам. Пустая.
 *
 * Документ разбирается прежней функцией (её поведение не меняется ни на йоту — у неё 
 * одиннадцать собственных проверок, и ломать их ради расширения нельзя). Новые типы
 * добавляются рядом: у каждого своя последняя точка и своя засчитываемая сверка.
 *
 * Возвращает { shouldBlock, doc, kinds:[{kind, satisfied, evidence}] }.
 */
export function decideAll(tools = []) {
  const doc = decide(tools);
  const kinds = deliverableKind(tools).map((k) => {
    const after = tools.slice(k.lastIdx + 1);
    // засчитываем и машинную сверку своего типа, и смысловую: на переносе дизайна
    // субагент, сравнивший макет с кодом, отвечает на тот же вопрос
    const satisfied = after.some((t) => isKindAudit(t, k.kind)) || after.some(isSemanticReview);
    return { ...k, satisfied };
  });
  return {
    shouldBlock: doc.shouldBlock || kinds.some((k) => !k.satisfied),
    doc,
    kinds,
  };
}

/** Текст блокировки для типа сдачи: команда, которой из неё выходят. Пустая. */
export function remedyFor(kind) {
  if (kind === 'design-port') {
    return [
      '  перенос дизайна в код — проверить, что доехали ВСЕ стили, а не только те, что бросились в глаза:',
      '    node ~/.claude/jidoka/scripts/synthesis-coverage-audit.mjs \\',
      '      --kind design-port --source <файл с инвентарём макета> --target <папка с изменёнными компонентами>',
      '    (инвентарь — это то, что уже отдал макет: токены, названия стилей и слоёв, сохранённые в файл)',
    ].join('\n');
  }
  if (kind === 'code-import') {
    return [
      '  перенос чужого кода — проверить, что доехали ВСЕ файлы:',
      '    node ~/.claude/jidoka/scripts/synthesis-coverage-audit.mjs \\',
      '      --kind code-import --source <папка-источник> --target <папка, куда переносили>',
    ].join('\n');
  }
  return `  тип "${kind}": машинной сверки нет, назовите вслух, что осталось непроверенным`;
}

function markerPath(sessionId) {
  const safe = String(sessionId || "nosession").replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(os.tmpdir(), `synthesis-coverage-gate-${safe}.marker`);
}

// ---------- self-test ----------

function selfTest() {
  const checks = [];
  const ok = (name, cond) => checks.push({ name, pass: !!cond });

  // опознание документов
  ok("ТЗ опознаётся", isSynthesisDoc("/x/ТЗ-Сайт-Клиент.md"));
  ok("Смета опознаётся", isSynthesisDoc("/x/Смета-проекта.md"));
  ok("Предложение опознаётся", isSynthesisDoc("/x/Предложение-клиенту.html"));
  ok("Итоги брифа опознаются", isSynthesisDoc("/x/Итоги-брифа.md"));
  ok("proposal.html опознаётся", isSynthesisDoc("/x/proposal.html"));
  ok("audit опознаётся", isSynthesisDoc("/x/security-audit.md"));

  ok("README не считается синтезом", !isSynthesisDoc("/x/README.md"));
  ok("код не считается синтезом", !isSynthesisDoc("/x/app/page.tsx"));
  ok("package.json не считается", !isSynthesisDoc("/x/package.json"));
  ok("special не путается со spec", !isSynthesisDoc("/x/specials.tsx"));

  // решение
  const write = (p) => ({ name: "Write", input: { file_path: p } });
  const audit = { name: "Bash", input: { command: "node ~/.claude/jidoka/scripts/synthesis-coverage-audit.mjs --doc a --sources b" } };
  const other = { name: "Bash", input: { command: "ls -la" } };

  const semantic = {
    name: "Agent",
    input: { prompt: "Прочитай источники и документ, найди что не отражено в ТЗ, пропуски" },
  };

  ok("синтез без сверки блокируется", decide([write("/x/ТЗ.md")]).shouldBlock === true);
  ok("синтез с механической сверкой проходит", decide([write("/x/ТЗ.md"), audit]).shouldBlock === false);
  ok("синтез со смысловой сверкой проходит", decide([write("/x/ТЗ.md"), semantic]).shouldBlock === false);
  ok("сверка ДО правки не засчитывается", decide([audit, write("/x/ТЗ.md")]).shouldBlock === true);
  ok("без синтеза не блокируется", decide([write("/x/app.tsx"), other]).shouldBlock === false);
  ok("пустой список не блокируется", decide([]).shouldBlock === false);
  ok("имя документа попадает в отчёт", decide([write("/x/Смета.md")]).docs.includes("Смета.md"));
  ok("флаги сверок возвращаются", decide([write("/x/ТЗ.md"), audit]).hadMechanical === true);
  ok(
    "посторонний субагент не засчитывается как сверка",
    decide([write("/x/ТЗ.md"), { name: "Agent", input: { prompt: "напиши тесты" } }]).shouldBlock === true
  );

  // повторная правка после сверки снова требует сверки
  ok(
    "правка после сверки снова требует сверки",
    decide([write("/x/ТЗ.md"), audit, write("/x/ТЗ.md")]).shouldBlock === true
  );

  // ---- типы сдачи (замер 2026-08-17: 11 сессий, гейт видел 1) ----
  const fig = { name: "mcp__figma__get_design_context", input: {} };
  const edit = (p) => ({ name: "Edit", input: { file_path: p } });
  const clone = { name: "Bash", input: { command: "git clone https://github.com/x/back.git ./back" } };
  const kindAudit = (k) => ({ name: "Bash", input: { command: `node scripts/synthesis-coverage-audit.mjs --kind ${k} --source a --target b` } });

  ok("источник дизайна опознаётся", isDesignSource(fig));
  ok("обычный инструмент не считается источником дизайна", !isDesignSource({ name: "Read" }));
  ok("git clone опознаётся как перенос кода", isCodeImport(clone));
  ok("gh repo clone опознаётся", isCodeImport({ name: "Bash", input: { command: "gh repo clone org/back" } }));
  ok("скачивание архива опознаётся", isCodeImport({ name: "Bash", input: { command: "curl -O https://x/y.tar.gz" } }));
  ok("обычная команда не считается переносом", !isCodeImport({ name: "Bash", input: { command: "npm test" } }));
  ok("git clone ВНУТРИ кавычек не срабатывает (упоминание, а не действие)",
    !isCodeImport({ name: "Bash", input: { command: "echo 'сначала git clone, потом сборка'" } }));
  ok("git clone в двойных кавычках не срабатывает",
    !isCodeImport({ name: "Bash", input: { command: 'git commit -m "описал git clone в доке"' } }));
  ok("git clone в комментарии не срабатывает",
    !isCodeImport({ name: "Bash", input: { command: "npm test  # git clone делали вчера" } }));
  ok("настоящий git clone после кавычек всё равно срабатывает",
    isCodeImport({ name: "Bash", input: { command: "echo 'готовлю' && git clone https://x/y.git" } }));

  // перенос дизайна: нужен порог, одна правка это не перенос
  ok("одна правка после макета НЕ считается переносом",
    deliverableKind([fig, edit("/a/x.tsx")]).length === 0);
  ok("две правки интерфейса после макета считаются переносом",
    deliverableKind([fig, edit("/a/x.tsx"), edit("/a/y.tsx")]).some((k) => k.kind === "design-port"));
  ok("правки НЕ интерфейса переносом не считаются",
    deliverableKind([fig, edit("/a/x.ts"), edit("/a/y.mjs")]).length === 0);
  ok("макет, открытый ПОСЛЕ правок, переносом не считается (это проверка, а не перенос)",
    deliverableKind([edit("/a/x.tsx"), edit("/a/y.tsx"), fig]).length === 0);
  ok("перенос кода опознаётся как тип", deliverableKind([clone]).some((k) => k.kind === "code-import"));
  ok("пустая сессия не даёт типов", deliverableKind([]).length === 0);

  // блокировка и выход из неё
  ok("перенос дизайна без сверки блокирует",
    decideAll([fig, edit("/a/x.tsx"), edit("/a/y.tsx")]).shouldBlock === true);
  ok("перенос дизайна со сверкой СВОЕГО типа проходит",
    decideAll([fig, edit("/a/x.tsx"), edit("/a/y.tsx"), kindAudit("design-port")]).shouldBlock === false);
  ok("сверка ЧУЖОГО типа не засчитывается",
    decideAll([fig, edit("/a/x.tsx"), edit("/a/y.tsx"), kindAudit("code-import")]).shouldBlock === true);
  ok("перенос кода без сверки блокирует", decideAll([clone]).shouldBlock === true);
  ok("перенос кода со сверкой проходит", decideAll([clone, kindAudit("code-import")]).shouldBlock === false);
  ok("смысловая сверка тоже засчитывается",
    decideAll([clone, { name: "Agent", input: { prompt: "сверь источник и цель, что не отражено, пропуски" } }]).shouldBlock === false);
  ok("сверка ДО переноса не засчитывается",
    decideAll([kindAudit("code-import"), clone]).shouldBlock === true);
  ok("обычная сессия без сдачи не блокируется", decideAll([{ name: "Bash", input: { command: "npm test" } }]).shouldBlock === false);
  ok("прежнее поведение по документам не изменилось",
    decideAll([write("/x/ТЗ.md")]).doc.shouldBlock === true && decideAll([write("/x/ТЗ.md")]).shouldBlock === true);
  ok("лечение называет исполнимую команду", /synthesis-coverage-audit/.test(remedyFor("design-port")));
  ok("лечение переноса кода называет свой режим", /--kind code-import/.test(remedyFor("code-import")));
  ok("непроверяемый тип честно не обещает команду", /машинной сверки нет/.test(remedyFor("plan-in-chat")));

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`${c.pass ? "  ok  " : " FAIL "} ${c.name}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exit(failed.length ? 1 : 0);
}

// ---------- запуск как хук ----------

function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  let payload = {};
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0); // fail-open
  }

  if (payload.stop_hook_active) process.exit(0);

  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

  const marker = markerPath(payload.session_id);
  if (fs.existsSync(marker)) process.exit(0); // блокируем только один раз

  let tools = [];
  try {
    // Хвост, а не весь файл: 158-МБ сессия стоила 0.7с на гейт (замер 2026-08-31).
    const lines = хвостТранскрипта(transcriptPath).split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        collectToolUses(JSON.parse(line), tools);
      } catch {}
    }
  } catch {
    process.exit(0);
  }

  const verdict = decideAll(tools);
  if (!verdict.shouldBlock) process.exit(0);

  try {
    fs.writeFileSync(marker, String(Date.now()));
  } catch {}

  // Новые типы сдачи блокируют отдельным, коротким текстом: у них другой вопрос и другая
  // команда выхода. Длинная лекция про документ-синтез здесь была бы не по делу.
  const unmet = verdict.kinds.filter((k) => !k.satisfied);
  if (!verdict.doc.shouldBlock && unmet.length) {
    const names = { 'design-port': 'перенос дизайна в код', 'code-import': 'перенос чужого кода' };
    process.stderr.write(
      `СТОП: сдача без проверки полноты.\n\n` +
        unmet.map((k) => `Что произошло: ${names[k.kind] || k.kind} (${k.evidence})`).join('\n') + `\n\n` +
        `Полнота такой сдачи не проверяется чтением: «применил ли все стили» и «доехали ли\n` +
        `все файлы» это вопросы к списку, а не к памяти. Прогони сверку:\n\n` +
        unmet.map((k) => remedyFor(k.kind)).join('\n\n') + `\n\n` +
        `Если это НЕ перенос (правил своё, макет открывал для справки) — скажи это прямо\n` +
        `в ответе владельцу, и на этом всё. Гейт блокирует один раз за сессию.\n\n` +
        `Затем отдельно назови: что проверено, что нашли, и чего проверить нельзя.\n`
    );
    process.exit(2);
  }

  const list = verdict.doc.docs.slice(0, 3).join(", ");
  process.stderr.write(
    `СТОП: документ-синтез сдаётся без сверки с источниками.\n\n` +
      `Изменено: ${list}\n\n` +
      `Это выжимка из внешних источников (созвон, переписка, анкета, документация).\n` +
      `Прежде чем отдавать, проверь, что ничего не потеряно. Два разных типа пропусков:\n\n` +
      `1. МЕХАНИЧЕСКИЙ — сущность есть в источнике, нет в документе (имя, сумма, название):\n\n` +
      `   node ~/.claude/jidoka/scripts/synthesis-coverage-audit.mjs \\\n` +
      `     --doc "<документ>" --sources "<папка источников>"\n\n` +
      `2. СМЫСЛОВОЙ — из слов клиента следует требование, которого в документе нет.\n` +
      `   Механика его не видит. Запусти навык synthesis-review: четыре субагента\n` +
      `   с разными рамками (деньги, техника, риски, невысказанное) читают источники\n` +
      `   против документа и возвращают непокрытые следствия.\n\n` +
      `Для короткого документа хватит первого. Для ТЗ, сметы и всего, что уходит\n` +
      `клиенту, нужны оба: они ловят разное.\n\n` +
      `Затем в ответе владельцу отдельно скажи: что проверено, что нашли,\n` +
      `и чего проверить нельзя.\n`
  );
  process.exit(2);
}


const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
