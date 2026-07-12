#!/usr/bin/env node
/**
 * proof-of-work-gate — Stop hook forcing function for declaration-over-implementation.
 *
 * Problem it closes (meta-ledger class `declaration-over-implementation`, seen 5×, the
 * highest-scoring lesson): work is declared "done / fixed / wired" without an EXECUTABLE
 * proof in the same session. The invocable proof-gate.mjs existed but nothing forced it
 * to run — a paper gate. This hook is the enforcement: it watches what the session DID,
 * not what it SAID.
 *
 * Behaviour: on Stop, scan this session's transcript. If the session EDITED source code
 * but NEVER executed anything after the last code edit (no test / typecheck / build /
 * script run via Bash, no browser verification tool), block the stop ONCE with a reason
 * telling Claude to run a proof before finishing.
 *
 * Safety (same contract as browser-verify-gate):
 *  - Fail-open: ANY error, or missing transcript, → exit 0 (never break the session).
 *  - Block at most ONCE per session (marker file), so it nudges, never locks.
 *  - Honours stop_hook_active to avoid re-trigger loops.
 *  - PRECISION over recall (lesson: precision-guard was 95% false-positive): docs,
 *    markdown, JSON/YAML config edits do not trigger; only source-code edits do.
 *
 * Usage:
 *   (as a hook) reads Stop-payload JSON on stdin; exit 2 + stderr blocks the stop.
 *   node proof-of-work-gate.mjs --self-test
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
// Source code whose behaviour can be EXECUTED. Docs/config/markdown are excluded on
// purpose (precision over recall): editing a .md never demands a test run.
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|vue|svelte|sql)$/i;
const EXCLUDE = /((^|\/)(node_modules|\.next|dist|build|coverage)\/|\.d\.ts$)/i;
// A Bash command that EXECUTES something — a test runner, a typecheck, a build, a script
// run, a self-test. Read-only commands (ls/cat/grep/git status) do not count as proof.
const PROOF_CMD =
  /\b(vitest|jest|pytest|unittest|mocha|tsc\b|eslint|playwright|next build|npm (run |exec )?\S*(test|build|lint|check)|pnpm \S*(test|build|lint|check)|yarn \S*(test|build|lint|check)|node(\s+--\S+)*\s+\S+\.(mjs|cjs|js|ts)|python3?\s+\S+\.py|--self-test|go test|cargo (test|check|build)|make (test|check)|bash \S+\.sh|sh \S+\.sh|zsh \S+\.sh)\b/i;
// Browser verification also proves observable behaviour (same set as browser-verify-gate).
const BROWSER_TOOL =
  /(claude_browser__|playwright__browser_|(^|_)preview_(start|screenshot|navigate|snapshot|inspect|click|fill|eval|logs|console)|claude-in-chrome__|computer-use__screenshot|__screenshot|browser_take_screenshot|browser_snapshot|browser_navigate)/i;

// pure: given the ordered tool uses of a session, does it need the proof nudge?
// Rule: a proof (executed command / browser look) must occur AFTER the LAST code edit —
// "fixed-without-rerun" (edit after the proof) still triggers.
export function needsProof(tools) {
  let lastEditIdx = -1;
  let lastProofIdx = -1;
  const editedFiles = [];
  tools.forEach((t, i) => {
    if (EDIT_TOOLS.has(t.name)) {
      const fp = t.input && (t.input.file_path || t.input.filePath || t.input.notebook_path);
      if (typeof fp === "string" && CODE_FILE.test(fp) && !EXCLUDE.test(fp)) {
        lastEditIdx = i;
        if (editedFiles.length < 5) editedFiles.push(fp);
      }
    }
    if (BROWSER_TOOL.test(t.name)) lastProofIdx = i;
    if (t.name === "Bash" && typeof (t.input && t.input.command) === "string" && PROOF_CMD.test(t.input.command)) {
      lastProofIdx = i;
    }
  });
  if (lastEditIdx === -1) return { block: false, editedFiles };
  return { block: lastProofIdx < lastEditIdx, editedFiles };
}

function main() {
  const raw = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  if (payload.stop_hook_active) process.exit(0);

  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

  const sessionId = payload.session_id || path.basename(transcriptPath);
  const markerDir = path.join(os.tmpdir(), "proof-of-work-gate");
  const marker = path.join(markerDir, `${sessionId}.fired`);
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

  const verdict = needsProof(tools);
  if (!verdict.block) process.exit(0);

  try {
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());
  } catch {
    process.exit(0);
  }

  const files = verdict.editedFiles.map((f) => f.replace(os.homedir(), "~")).join(", ");
  const reason =
    "PROOF-OF-WORK-GATE: this session edited source code (" +
    files +
    ") but nothing was EXECUTED after the last edit — no test, no typecheck, no script run, no browser look. " +
    "Rule (Engineering Discipline #4, meta-class declaration-over-implementation): no 'done' without an executable proof in the same session. " +
    "Run the proof now — the relevant test / --self-test / tsc / the script itself — show its output, THEN finish. " +
    "If the edit is genuinely not executable (e.g. a comment-only change), say so explicitly in your final message.";

  process.stderr.write(reason + "\n");
  process.exit(2);
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  const edit = (fp) => ({ name: "Edit", input: { file_path: fp } });
  const bash = (cmd) => ({ name: "Bash", input: { command: cmd } });
  const T = [
    ["no edits → pass", needsProof([bash("ls"), bash("git status")]).block === false],
    ["code edit + no run → block", needsProof([edit("src/a.ts")]).block === true],
    ["code edit + test after → pass", needsProof([edit("src/a.ts"), bash("npx vitest run a.test.ts")]).block === false],
    ["code edit + script run after → pass", needsProof([edit("scripts/x.mjs"), bash("node scripts/x.mjs --self-test")]).block === false],
    ["fixed-without-rerun: test BEFORE last edit → block", needsProof([bash("npx tsc --noEmit"), edit("src/a.ts")]).block === true],
    ["md-only edit → pass", needsProof([edit("docs/NOTES.md")]).block === false],
    ["json config edit → pass", needsProof([edit("settings.json")]).block === false],
    ["browser look counts as proof", needsProof([edit("app/page.tsx"), { name: "mcp__playwright__browser_take_screenshot", input: {} }]).block === false],
    ["built-in Claude Browser counts as proof", needsProof([edit("app/page.tsx"), { name: "mcp__Claude_Browser__computer", input: { action: "screenshot" } }]).block === false],
    ["built-in Claude Browser read_page counts", needsProof([edit("app/page.tsx"), { name: "mcp__Claude_Browser__read_page", input: {} }]).block === false],
    ["read-only bash is NOT proof", needsProof([edit("src/a.ts"), bash("cat src/a.ts"), bash("git diff")]).block === true],
    ["node_modules edit ignored", needsProof([edit("node_modules/x/index.js")]).block === false],
    [".d.ts edit ignored", needsProof([edit("src/types.d.ts")]).block === false],
    ["shell script run counts", needsProof([edit("hooks/g.sh"), bash("bash hooks/g.sh")]).block === false],
    ["tool-use collector finds nested uses", (() => { const out = []; collectToolUses({ message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "a.ts" } }] } }, out); return out.length === 1 && out[0].name === "Edit"; })()],
  ];
  let fail = 0;
  for (const [name, ok] of T) {
    if (!ok) fail++;
    console.log(`${ok ? "✓" : "✗"} ${name}`);
  }
  console.log(fail === 0 ? `SELF-TEST PASS (${T.length} checks)` : `SELF-TEST FAIL (${fail}/${T.length})`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  try {
    main();
  } catch {
    process.exit(0);
  }
}
