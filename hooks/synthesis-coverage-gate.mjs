#!/usr/bin/env node
// @closes-class: synthesis-shipped-without-coverage-audit
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
    const lines = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        collectToolUses(JSON.parse(line), tools);
      } catch {}
    }
  } catch {
    process.exit(0);
  }

  const { shouldBlock, docs } = decide(tools);
  if (!shouldBlock) process.exit(0);

  try {
    fs.writeFileSync(marker, String(Date.now()));
  } catch {}

  const list = docs.slice(0, 3).join(", ");
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
