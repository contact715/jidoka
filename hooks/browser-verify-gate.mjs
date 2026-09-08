#!/usr/bin/env node
// @closes-class: browser-verification-skipped
/**
 * browser-verify-gate — Stop hook forcing function.
 *
 * Problem it closes (owner escalation 2026-07-02): "в каждой сессии ты не делаешь
 * проверку в браузере и пропускаешь!". Editing observable UI without ever opening a
 * browser to LOOK is the recurring miss. Docs alone (spatial-design Q7) get skipped.
 *
 * Behaviour: on Stop, scan this session's transcript. If the session EDITED observable
 * UI source (*.tsx/*.jsx/*.css/*.scss under app/ or components/, excluding tests) but
 * NEVER called a browser verification tool (Claude_Browser / preview_* / playwright / claude-in-chrome /
 * computer-use screenshot), block the stop ONCE with a reason telling Claude to verify.
 *
 * Safety:
 *  - Fail-open: ANY error, or missing transcript, → exit 0 (never break the session).
 *  - Block at most ONCE per session (marker file), so it nudges, never locks.
 *  - Honours stop_hook_active to avoid re-trigger loops.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from 'node:url';
import childProcess from "node:child_process";
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

function collectToolUses(node, out) {
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

// Результаты инструментов, а не только вызовы. Гейт, который видит ТОЛЬКО вызовы,
// умеет спросить «смотрел ли ты», но не «было ли на что смотреть».
function collectToolResults(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const item of node) collectToolResults(item, out); return; }
  if (node.type === "tool_result") { try { out.push(JSON.stringify(node.content ?? "")); } catch { /* нечитаемый результат пропускаем */ } }
  for (const key of Object.keys(node)) { if (key === "type") continue; collectToolResults(node[key], out); }
}

// Зонд пригодности: вызов, который спрашивает у страницы, видима ли она и есть ли
// у неё высота. Ищем ВЫЗОВ ИНСТРУМЕНТА, а не слова в тексте: упоминание зонда в
// рассуждении не является зондом (класс guard-fires-on-mention-not-action).
const PROBE = /visibilityState/i;
const PROBE_SIZE = /innerHeight|clientHeight/i;
// Опровержение: страница прямо ответила, что она скрыта или нулевой высоты.
const HIDDEN = /"?visibilityState"?\s*:\s*"?hidden/i;
const ZERO_H = /"?(innerHeight|clientHeight)"?\s*:\s*0\b/i;

/**
 * Чистая: пригодно ли наблюдение, а не был ли вызван инструмент.
 *
 * Три исхода, и «не доказано» отличается от «опровергнуто» намеренно: первое лечится
 * одним вызовом, второе означает, что уже сделанный вывод о продукте построен на
 * чёрном экране и его надо отозвать.
 *
 * @returns {{verdict:'proved'|'refuted'|'unproved', why:string}}
 */
export function observationUsable(toolInputs = [], resultTexts = []) {
  // Результат приходит сериализованным, поэтому кавычки внутри экранированы:
  // "{\"visibilityState\":\"hidden\"}". Шаблон, написанный на неэкранированный
  // вид, молча не совпадал, и опровержение проваливалось в ветку «не доказано» —
  // гейт блокировал, но НЕ ТЕМ сообщением. Поймано вторым плечом собственной
  // самопроверки, а не первым: первое проверяло только код возврата.
  const clean = (x) => String(x).replace(/\\"/g, '"');
  for (const raw of resultTexts) {
    const t = clean(raw);
    if (HIDDEN.test(t)) return { verdict: "refuted", why: "страница ответила visibilityState=hidden" };
    if (ZERO_H.test(t)) return { verdict: "refuted", why: "страница ответила нулевой высотой окна" };
  }
  const probed = toolInputs.some((t) => PROBE.test(t) && PROBE_SIZE.test(t));
  return probed
    ? { verdict: "proved", why: "зонд пригодности вызван и не опровергнут" }
    : { verdict: "unproved", why: "зонд пригодности не вызывался" };
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// Observable UI source. Tests / type decls / non-UI trees are not "look at it in a browser".
const UI_FILE = /\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/i;
const UI_PATH = /(^|\/)(app|components|src|pages|widgets|ui)\//i;
const EXCLUDE = /(__tests__|\.test\.|\.spec\.|\.stories\.|\.d\.ts$|\/(scripts|docs|node_modules|\.next|dist|build)\/)/i;
// Any tool that means "a browser was actually driven / a screen was captured".
const BROWSER_TOOL =
  /(claude_browser__|playwright__browser_|(^|_)preview_(start|screenshot|navigate|snapshot|inspect|click|fill|eval|logs|console)|claude-in-chrome__|computer-use__screenshot|__screenshot|browser_take_screenshot|browser_snapshot|browser_navigate)/i;

function main() {
  const raw = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  // Already inside a stop-hook re-trigger → never loop.
  if (payload.stop_hook_active) process.exit(0);

  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

  const sessionId = payload.session_id || path.basename(transcriptPath);
  const markerDir = path.join(os.tmpdir(), "browser-verify-gate");
  const marker = path.join(markerDir, `${sessionId}.fired`);
  // Already nudged this session → let the stop through.
  if (fs.existsSync(marker)) process.exit(0);

  let lines = [];
  try {
    // Хвост, а не весь файл: 158-МБ сессия стоила 0.7с на гейт (замер 2026-08-31).
    lines = хвостТранскрипта(transcriptPath).split("\n").filter(Boolean);
  } catch {
    process.exit(0);
  }

  const tools = [];
  const results = [];
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    collectToolUses(obj, tools);
    collectToolResults(obj, results);
  }

  let editedUi = false;
  let usedBrowser = false;
  const editedFiles = [];
  for (const t of tools) {
    if (BROWSER_TOOL.test(t.name)) usedBrowser = true;
    if (EDIT_TOOLS.has(t.name)) {
      const fp = t.input && (t.input.file_path || t.input.filePath || t.input.notebook_path);
      if (typeof fp === "string" && UI_FILE.test(fp) && UI_PATH.test(fp) && !EXCLUDE.test(fp)) {
        editedUi = true;
        if (editedFiles.length < 5) editedFiles.push(fp.replace(os.homedir(), "~"));
      }
    }
  }

  if (!editedUi) process.exit(0);

  // Ось пригодности. Вызов браузерного инструмента доказывает, что браузер ОТКРЫВАЛИ,
  // и ничего не говорит о том, было ли на что смотреть. За десять дней это дало три
  // инцидента, два из них — заявление о несуществующем дефекте продукта по снимку из
  // скрытой панели с нулевой высотой окна.
  let usable = { verdict: "unproved", why: "" };
  if (usedBrowser) {
    const inputs = tools.map((t) => { try { return JSON.stringify(t.input || {}); } catch { return ""; } });
    usable = observationUsable(inputs, results);
    if (usable.verdict === "proved") process.exit(0);
  }

  // Fire once.
  try {
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());
  } catch {
    // If we cannot write the marker, still nudge but don't risk a loop: exit 0.
    process.exit(0);
  }

  const files = editedFiles.join(", ");

  if (usedBrowser && usable.verdict === "refuted") {
    process.stderr.write(
      "BROWSER-VERIFY-GATE: наблюдение НЕПРИГОДНО — " + usable.why + ".\n" +
      "Панель браузера была скрыта или нулевой высоты, значит страница не могла нарисоваться ПО ПОСТРОЕНИЮ. " +
      "Любой вывод о продукте, сделанный по этому наблюдению, надо отозвать: это измерение скрытости вкладки, а не продукта. " +
      "Открой панель (mcp__Claude_Browser__tabs_select), убедись, что innerHeight больше нуля, и посмотри заново.\n");
    process.exit(2);
  }

  if (usedBrowser && usable.verdict === "unproved") {
    process.stderr.write(
      "BROWSER-VERIFY-GATE: браузер открывали, но пригодность наблюдения не доказана.\n" +
      "Вызов инструмента доказывает, что браузер ОТКРЫВАЛИ, и ничего не говорит о том, было ли на что смотреть: " +
      "в скрытой панели innerHeight равен нулю, 100dvh равен нулю, и вся раскладка честно пустая. " +
      "Три инцидента за десять дней пришли отсюда, два — с заявлением о несуществующем дефекте продукта.\n" +
      "Прогони зонд ОДИН раз и посмотри ответ:\n" +
      "  mcp__Claude_Browser__javascript_tool → ({visibilityState: document.visibilityState, innerHeight, innerWidth})\n" +
      "Если ответ hidden или ноль — это не дефект продукта, это скрытая панель.\n");
    process.exit(2);
  }

  const reason =
    "BROWSER-VERIFY-GATE: this session edited observable UI (" +
    files +
    ") but never opened a browser to LOOK. Rule ~/.claude/rules/browser-verification-mandatory.md: for ANY visible change, open the BUILT-IN Claude Code browser (mcp__Claude_Browser__* / preview_* tools — owner's standing choice 2026-07-12; Playwright only as fallback when the Browser pane is unavailable), navigate to the affected screen, screenshot it, and confirm with your eyes before finishing. " +
    "If the normal screen has no data (backend down / mocks off), render the component on a throwaway route or in an isolated worktree and screenshot THAT — missing data is not a reason to skip. " +
    "Do the browser check now, then finish. If it is genuinely not observable in any browser (non-web change), say so explicitly in your final message.";

  // exit 2 + stderr → block the Stop and feed the reason back to Claude.
  process.stderr.write(reason + "\n");
  process.exit(2);
}


// @divergence: "скрытая панель опровергает наблюдение" — вызов браузерного инструмента
// говорит «смотрел», а страница при этом была нулевой высоты; величина и правило
// расходятся ровно здесь, и до 2026-09-07 гейт мерил только величину.
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; console.log("  \u001b[32m\u2713\u001b[0m " + n); } else { fail++; console.log("  \u001b[31m\u2717\u001b[0m " + n); } };

  // чистые плечи
  ok("зонд не вызывался — не доказано",
    observationUsable(['{"url":"http://x"}'], ["ok"]).verdict === "unproved");
  ok("зонд вызван и не опровергнут — доказано",
    observationUsable(['{"text":"({visibilityState: document.visibilityState, innerHeight})"}'], ['{"visibilityState":"visible","innerHeight":812}']).verdict === "proved");
  ok("скрытая панель опровергает наблюдение",
    observationUsable(['{"text":"visibilityState innerHeight"}'], ['{"visibilityState":"hidden","innerHeight":0}']).verdict === "refuted");
  ok("нулевая высота опровергает даже при visible",
    observationUsable(['{"text":"visibilityState innerHeight"}'], ['{"visibilityState":"visible","innerHeight":0}']).verdict === "refuted");
  ok("опровержение сильнее зонда: вывод надо отозвать, а не повторить зонд",
    observationUsable(['{"text":"visibilityState innerHeight"}'], ['{"innerHeight":0}']).why.length > 0);
  ok("упоминание слова без второго признака зондом не считается",
    observationUsable(['{"text":"надо бы глянуть visibilityState"}'], ["ok"]).verdict === "unproved");

  // сквозное плечо: синтетический транскрипт через stdin, настоящий процесс
  const os2 = os, fs2 = fs, path2 = path;
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), "bvg-"));
  const tp = path2.join(dir, "t.jsonl");
  const rows = [
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/p/components/Card.tsx" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__Claude_Browser__computer", input: { action: "screenshot" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: '{"visibilityState":"hidden","innerHeight":0}' }] } },
  ];
  fs2.writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const { spawnSync } = childProcess;
  const run = (sid) => spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    input: JSON.stringify({ transcript_path: tp, session_id: sid }), encoding: "utf8",
  });
  const r1 = run("bvg-red-" + Date.now());
  ok("СКВОЗНОЕ КРАСНОЕ: правка UI + браузер + скрытая панель = блок", r1.status === 2);
  ok("и человеку сказано, что вывод надо отозвать", /отозвать/.test(r1.stderr || ""));

  // зелёное плечо той же формы: пригодное наблюдение проходит
  const tp2 = path2.join(dir, "t2.jsonl");
  const rows2 = [
    rows[0],
    { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__Claude_Browser__javascript_tool", input: { text: "({visibilityState: document.visibilityState, innerHeight})" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: '{"visibilityState":"visible","innerHeight":812}' }] } },
  ];
  fs2.writeFileSync(tp2, rows2.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const r2 = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    input: JSON.stringify({ transcript_path: tp2, session_id: "bvg-green-" + Date.now() }), encoding: "utf8",
  });
  ok("СКВОЗНОЕ ЗЕЛЁНОЕ: пригодное наблюдение проходит", r2.status === 0);

  fs2.rmSync(dir, { recursive: true, force: true });
  console.log(`\nbrowser-verify-gate self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain && process.argv.includes("--self-test")) {
  process.exit(selfTest() ? 0 : 1);
}

if (isMain) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}
