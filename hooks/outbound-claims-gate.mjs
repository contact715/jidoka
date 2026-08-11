#!/usr/bin/env node
// @closes-class: fabricated-plausible-detail
/**
 * outbound-claims-gate — forcing function against fabricated verifiable specifics.
 *
 * Origin (owner escalation, projectx 2026-07-24): a partner-facing email to Thumbtack
 * carried an invented redirect URI (`https://mosco.ai/auth/thumbtack/callback` — host
 * serves the marketing site, route absent from the repo, real app host has no DNS).
 * The owner caught it by eye. Nothing in the toolchain looked.
 *
 * Two modes, wired in ~/.claude/settings.json:
 *
 *   PreToolUse  — before ANY outbound send (email, Telegram, WhatsApp, iMessage, Slack,
 *                 Jira/Confluence/GitHub comment), verify every URL and host in the
 *                 payload. A definitively dead address blocks the send.
 *
 *   Stop        — before finishing a turn, re-read this session's own assistant text and
 *                 verify addresses on domains WE OWN. Catches the draft-in-chat case,
 *                 which is where the Thumbtack miss actually happened. Blocks once.
 *
 * Safety: fail-open on every error (no transcript, no verifier, no network → exit 0).
 * Only DEFINITIVE negatives block: NXDOMAIN, HTTP 404/410, or an owned-host path with
 * no matching route in the repo. Timeouts and 5xx never block.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERIFIER = path.join(os.homedir(), ".claude", "jidoka", "scripts", "verify-claims.mjs");
const MAX_TEXT = 200_000;

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Tools that put words in front of someone outside this machine. */
const OUTBOUND_TOOL =
  /(create_draft|send_message|send_imessage|sendmessage|__reply$|__reply\b|edit_message|send_email|sendemail|whatsapp.*send|telegram.*(reply|send)|slack.*(post|send)|add_?comment|addCommentToJiraIssue|create(Confluence|Jira)|create_issue|create_pull_request|add_issue_comment|create_notification|create_update)/i;

/** Collect every string leaf of an object — the payload text, whatever the schema. */
function collectStrings(node, out, depth = 0) {
  if (depth > 8 || out.length > 400) return;
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const v of Array.isArray(node) ? node : Object.values(node)) collectStrings(v, out, depth + 1);
}

/**
 * Assistant text written in the CURRENT turn — everything after the last user message.
 *
 * Scoping matters. Scanning the whole transcript makes the gate re-litigate addresses
 * that were already disclosed and corrected turns ago, and a session resume drops the
 * "already reported" marker so they resurface as if new. The question this gate asks is
 * "did I just state an invented address", so only the newest output can answer it.
 */
function collectAssistantText(transcriptPath) {
  let lines = [];
  try {
    lines = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  } catch {
    return "";
  }

  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      /* skip unparseable line */
    }
  }

  let start = 0;
  for (let i = parsed.length - 1; i >= 0; i--) {
    const role = parsed[i] && parsed[i].message && parsed[i].message.role;
    if (role === "user") {
      start = i + 1;
      break;
    }
  }

  const chunks = [];
  for (const obj of parsed.slice(start)) {
    const msg = obj && obj.message;
    if (!msg || msg.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") chunks.push(content);
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && part.type === "text" && typeof part.text === "string") chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").slice(-MAX_TEXT);
}

async function runVerifier(text, ownedOnly) {
  let mod;
  try {
    mod = await import(`file://${VERIFIER}`);
  } catch {
    return null; // verifier missing → fail open
  }
  if (typeof mod.verifyClaims !== "function") return null;
  const owned = typeof mod.loadOwnedDomains === "function" ? mod.loadOwnedDomains(null) : [];
  if (ownedOnly && !owned.length) return null; // nothing declared as ours → nothing to police
  try {
    return await mod.verifyClaims(text, { owned, repo: process.cwd(), ownedOnly });
  } catch {
    return null;
  }
}

/**
 * An address REPORTED as dead is not a fabricated claim — it is the correction itself.
 * Without this, the Stop mode fires on the very message that says "this address does not
 * exist", which is exactly the honest behaviour we want to encourage. (Found on the gate's
 * first live firing, 2026-07-24: it flagged the message that disclosed both dead hosts.)
 */
const DEAD_MARKER =
  /(404|410|does not exist|doesn't exist|no DNS|dead|DEAD|invented|fabricat|не существу|несуществ|мёртв|мертв|выдум|не поднят|отсутству|нет DNS|не резолв)/i;

function isReportedAsDead(text, value) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(value)) continue;
    // The verdict often sits on the neighbouring line (a table row, a bullet, a note).
    const context = [lines[i - 1] || "", lines[i], lines[i + 1] || "", lines[i + 2] || ""].join(" ");
    if (!DEAD_MARKER.test(context)) return false; // at least one bare mention → still a claim
  }
  return true;
}

function describe(dead) {
  return dead
    .map((d) => `  - ${d.value}\n      ${d.notes.filter(Boolean).join("\n      ")}`)
    .join("\n");
}

async function preToolUse(payload) {
  const toolName = payload.tool_name || "";
  if (!OUTBOUND_TOOL.test(toolName)) process.exit(0);

  const strings = [];
  collectStrings(payload.tool_input || {}, strings);
  const text = strings.join("\n").slice(0, MAX_TEXT);
  if (!text.trim()) process.exit(0);

  const verdict = await runVerifier(text, false);
  if (!verdict || verdict.ok) process.exit(0);

  process.stderr.write(
    "OUTBOUND-CLAIMS-GATE: this message is about to leave the machine and contains " +
      `${verdict.dead.length} address(es) that do not exist:\n${describe(verdict.dead)}\n\n` +
      "These were not verified — they were inferred. Do not send invented specifics to anyone outside. " +
      "Check each one (curl / dig / look for the route in the repo), replace it with the real value or remove it, " +
      "then send. Rule: ~/.claude/rules/no-fabricated-specifics.md\n"
  );
  process.exit(2);
}

async function stop(payload) {
  if (payload.stop_hook_active) process.exit(0);
  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

  const sessionId = payload.session_id || path.basename(transcriptPath);
  const markerDir = path.join(os.tmpdir(), "outbound-claims-gate");
  const marker = path.join(markerDir, `${sessionId}.json`);

  // Book-keeping is per ADDRESS, not per session. A once-per-session gate lets the
  // SECOND invented address sail through — which is exactly what happened on
  // 2026-07-24: the gate fired on mosco.ai/auth/thumbtack/callback, then stayed silent
  // when `staging.mosco.ai` was invented two turns later. Each new fabricated address
  // gets its own block; ones already reported stay quiet so the gate cannot loop.
  let reported = new Set();
  try {
    reported = new Set(JSON.parse(fs.readFileSync(marker, "utf8")).reported || []);
  } catch {
    /* first run this session */
  }

  const text = collectAssistantText(transcriptPath);
  if (!text.trim()) process.exit(0);

  const verdict = await runVerifier(text, true);
  if (!verdict || verdict.ok) process.exit(0);

  // Drop the ones this very message already disclosed as dead — reporting a broken
  // address is the fix, not the defect — and the ones already blocked on earlier.
  const asserted = verdict.dead.filter(
    (d) => !isReportedAsDead(text, d.value) && !reported.has(d.value)
  );
  if (!asserted.length) process.exit(0);
  verdict.dead = asserted;

  try {
    fs.mkdirSync(markerDir, { recursive: true });
    for (const d of asserted) reported.add(d.value);
    fs.writeFileSync(marker, JSON.stringify({ reported: [...reported] }));
  } catch {
    process.exit(0);
  }

  process.stderr.write(
    "OUTBOUND-CLAIMS-GATE: you told the owner about " +
      `${verdict.dead.length} address(es) on our own domains that do not exist:\n${describe(verdict.dead)}\n\n` +
      "A specific you inferred is not a fact. Verify it now (dig / curl / find the route in the repo), " +
      "then correct what you told them explicitly — do not let an invented detail stand. " +
      "Rule: ~/.claude/rules/no-fabricated-specifics.md\n"
  );
  process.exit(2);
}

async function main() {
  const mode = process.argv[2] || "PreToolUse";
  const raw = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }
  if (mode === "Stop") return stop(payload);
  return preToolUse(payload);
}

main().catch(() => process.exit(0));
