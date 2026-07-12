#!/usr/bin/env node
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
    lines = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  } catch {
    process.exit(0);
  }

  const tools = [];
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    collectToolUses(obj, tools);
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

  if (!editedUi || usedBrowser) process.exit(0);

  // Fire once.
  try {
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());
  } catch {
    // If we cannot write the marker, still nudge but don't risk a loop: exit 0.
    process.exit(0);
  }

  const files = editedFiles.join(", ");
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

try {
  main();
} catch {
  process.exit(0);
}
