#!/usr/bin/env node
// @closes-class: stopped-mid-queue-reported-instead
/**
 * task-queue-gate — a Stop hook against stopping with the queue still full.
 *
 * THE CLASS IT CLOSES (`stopped-mid-queue-reported-instead`, caught by the owner 2026-08-03):
 * the session pulled work from the serial queue, did one item, and then STOPPED to report instead
 * of working the queue to empty. The standing order is the opposite: pull one, drive it to done,
 * pull the next, however many are queued. The queue is shown at session START by the digest, and
 * until now nothing looked at it at the END — the one moment where stopping early is the mistake.
 *
 * PRECISION OVER RECALL, deliberately. The hook fires only when BOTH are true:
 *   1. this session actually worked the queue (it ran `task-queue.mjs next|done|fail` in Bash), and
 *   2. the queue still holds queued items.
 * A session that never touched the queue is none of this hook's business. Blocking every session
 * because some global queue is non-empty would be the 2026-08-08 defect again, where a guard fired
 * on a MENTION rather than an action and blocked its own author's commit.
 *
 * Safety, same contract as proof-of-work-gate and browser-verify-gate:
 *  - Fail-open: any error, missing transcript, unreadable queue → exit 0.
 *  - Blocks at most ONCE per session (marker file) — it nudges, it never locks.
 *  - Honours stop_hook_active so it cannot re-trigger itself.
 *
 * Self-test: node hooks/task-queue-gate.mjs --self-test
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

const QUEUE = process.env.TASK_QUEUE || path.join(os.homedir(), '.jidoka', 'task-queue', 'queue.jsonl');

// A Bash command that DRIVES the queue. `list`/`status` are read-only: looking at the queue is not
// working it, and a session that only looked should not be told it abandoned anything.
const DRIVES_QUEUE = /task-queue(?:\.mjs)?\s+(next|done|fail)\b/;

/**
 * Strip quoted DATA from a command line, leaving only its syntax. Without this the hook fires on a
 * commit MESSAGE that merely names the command — the same shape as the 2026-08-08 incident where
 * permission-gate blocked the very commit that introduced it, because the flag it polices appeared
 * inside the message text. What a command SAYS is data; what it RUNS is syntax.
 */
export function commandSyntaxOnly(cmd = '') {
  return String(cmd)
    .replace(/<<'?(\w+)'?[\s\S]*?^\1/gm, ' ')  // heredocs (commit messages usually arrive this way)
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ');
}

// A command that points TASK_QUEUE somewhere else is not driving the REAL queue — it is exercising
// the tool against a fixture. Caught on 2026-08-15 by this hook firing on the very session that
// wrote it: the end-to-end test of the stale-lock thaw ran `TASK_QUEUE=$Q ... next` against a
// mktemp file, and the hook read it as abandoned work. Same family as the mention-vs-action defect
// it already guards: the command was real, the TARGET was not.
const REDIRECTS_QUEUE = /\bTASK_QUEUE\s*=/;

/** Did this session actually work the REAL queue? Pure over the collected Bash commands. */
export function workedTheQueue(commands = []) {
  return commands.some((c) => {
    const syntax = commandSyntaxOnly(c);
    return DRIVES_QUEUE.test(syntax) && !REDIRECTS_QUEUE.test(syntax);
  });
}

/**
 * The verdict. Pure: takes what the session did and what the queue holds.
 * @returns {{block:boolean, waiting:number, reason:string}}
 */
export function queueVerdict(commands = [], items = []) {
  const waiting = items.filter((t) => t && t.status === 'queued').length;
  if (!workedTheQueue(commands)) return { block: false, waiting, reason: 'сессия очередь не трогала — не наше дело' };
  if (waiting === 0) return { block: false, waiting, reason: 'очередь пуста — так и надо заканчивать' };
  return {
    block: true,
    waiting,
    reason: `TASK-QUEUE-GATE: эта сессия брала задачи из очереди, но останавливается, когда в ней ещё ${waiting} задач(и) со статусом queued. `
      + 'Стоячий порядок: тянуть по одной до пустой очереди, а не отчитываться после первой. '
      + 'Возьми следующую: node ~/.claude/jidoka/scripts/task-queue.mjs next — доведи её до конца и коммита, потом следующую. '
      + 'Если очередь надо оставить как есть (владелец переключил задачу, задачи чужие, работа заблокирована), скажи это явно в финальном сообщении.',
  };
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function collectBashCommands(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { for (const x of obj) collectBashCommands(x, out); return; }
  if (obj.type === 'tool_use' && obj.name === 'Bash' && obj.input && typeof obj.input.command === 'string') out.push(obj.input.command);
  for (const v of Object.values(obj)) if (v && typeof v === 'object') collectBashCommands(v, out);
}

function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const queued = [{ status: 'queued' }, { status: 'queued' }, { status: 'done' }];

  ok('a session that pulled work is recognised', workedTheQueue(['node scripts/task-queue.mjs next']) === true);
  ok('marking a task done also counts as working it', workedTheQueue(['node scripts/task-queue.mjs done abc123']) === true);
  ok('merely LISTING the queue is not working it', workedTheQueue(['node scripts/task-queue.mjs list']) === false);
  ok('checking status is not working it either', workedTheQueue(['node scripts/task-queue.mjs status']) === false);
  // the 2026-08-08 defect: a guard that fires on a MENTION rather than an action
  ok('the phrase inside a commit message does NOT count as working the queue',
    workedTheQueue(['git commit -m "describe task-queue.mjs next behaviour"']) === false);
  ok('the phrase inside a heredoc commit message does NOT count either',
    workedTheQueue([["git commit -F - <<'EOF'", 'run task-queue.mjs next after this', 'EOF'].join('\n')]) === false);
  // the hook's own first false positive (2026-08-15): a fixture run is not queue work
  ok('a run against a TEMP queue is not working the real one',
    workedTheQueue(['TASK_QUEUE="/tmp/x/q.jsonl" node scripts/task-queue.mjs next']) === false);
  ok('the redirect is caught with or without quotes',
    workedTheQueue(['TASK_QUEUE=/tmp/q.jsonl node scripts/task-queue.mjs done abc']) === false);
  ok('but a plain run against the DEFAULT queue still counts',
    workedTheQueue(['node scripts/task-queue.mjs next']) === true);
  ok('an unrelated session is untouched', queueVerdict(['npm test'], queued).block === false);

  ok('worked the queue + items still waiting → block', queueVerdict(['node scripts/task-queue.mjs next'], queued).block === true);
  ok('the block names how many are waiting', /ещё 2 задач/.test(queueVerdict(['node scripts/task-queue.mjs next'], queued).reason));
  ok('worked the queue + nothing waiting → no block',
    queueVerdict(['node scripts/task-queue.mjs next'], [{ status: 'done' }, { status: 'in_progress' }]).block === false);
  ok('an in_progress task alone does not count as waiting',
    queueVerdict(['node scripts/task-queue.mjs next'], [{ status: 'in_progress' }]).block === false);
  ok('an empty queue with an empty session blocks nothing', queueVerdict([], []).block === false);
  ok('the reason always explains the escape hatch', /скажи это явно/.test(queueVerdict(['task-queue.mjs next'], queued).reason));

  if (fails) { console.log('\n\x1b[31mtask-queue-gate self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ task-queue-gate: блокирует остановку с непустой очередью только у сессии, которая её вела\x1b[0m');
  process.exit(0);
}

function main() {
  const raw = readStdin();
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }
  if (payload.stop_hook_active) process.exit(0);

  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

  const sessionId = payload.session_id || path.basename(transcriptPath);
  const markerDir = path.join(os.tmpdir(), 'task-queue-gate');
  const marker = path.join(markerDir, `${sessionId}.fired`);
  if (fs.existsSync(marker)) process.exit(0);

  let items = [];
  try {
    if (!fs.existsSync(QUEUE)) process.exit(0);
    items = fs.readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { process.exit(0); }

  let commands = [];
  try {
    // Хвост, а не весь файл: 158-МБ сессия стоила 0.7с на гейт (замер 2026-08-31).
    for (const line of хвостТранскрипта(transcriptPath).split('\n').filter(Boolean)) {
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      collectBashCommands(obj, commands);
    }
  } catch { process.exit(0); }

  const v = queueVerdict(commands, items);
  if (!v.block) process.exit(0);

  try {
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());
  } catch { process.exit(0); }

  process.stderr.write(v.reason + '\n');
  process.exit(2);
}


const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  main();
}
