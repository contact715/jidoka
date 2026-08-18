#!/usr/bin/env node
// @closes-class: gate-cost-not-proportional-to-change
// gate-audit — the single map of every gate: which LAYER enforces it (CI / PreToolUse / runtime
// dispatch / product pre-push / LLM-judge) and its MODE (hard-block / soft-warn / proxy / kernel /
// measured / degrade-skip). Then it VERIFIES the claims: a gate marked CI must actually appear in a
// workflow file. This is anti-ghost for the GATES THEMSELVES — "we have a security gate" must mean
// it runs somewhere real (the security-gate.yml ghost is exactly what this catches).
//
// Answers "which gates are weak / not enforced / where" mechanically, not by opinion.
//
// FULL & self-tested. Usage: node scripts/gate-audit.mjs [--self-test]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const GATES = [
  // CI — run on every push/PR, hard-block
  { id: 'meta-audit', layer: 'CI', mode: 'hard', token: 'meta-audit.mjs' },
  { id: 'meta-honesty', layer: 'CI', mode: 'hard', token: 'meta-honesty.mjs' },
  { id: 'ledger-schema-gate', layer: 'CI', mode: 'hard', token: 'gate:ledger-schema' },
  { id: 'test:engine', layer: 'CI', mode: 'hard', token: 'test:engine' },
  { id: 'eval-suite', layer: 'CI', mode: 'hard', token: 'npm run eval' },
  { id: 'check:structural', layer: 'CI', mode: 'hard', token: 'check:structural' },
  { id: 'check:security', layer: 'CI', mode: 'hard', token: 'check:security' },
  { id: 'pre-publish-guard', layer: 'CI', mode: 'hard', token: 'pre-publish-guard.mjs' },
  { id: 'instantiation-audit', layer: 'CI', mode: 'hard', token: 'instantiation-audit.mjs' },
  { id: 'execution-gate', layer: 'CI', mode: 'hard', token: 'execution-gate.mjs' },
  { id: 'gate-audit', layer: 'CI', mode: 'hard', token: 'gate-audit.mjs' },
  // CI — spec-tree structural gates (wave: spec-tree-overhaul)
  { id: 'spec-structural-gate', layer: 'CI', mode: 'hard', token: 'spec-structural-gate.mjs' },
  { id: 'validate-raci', layer: 'CI', mode: 'hard', token: 'validate-raci.mjs' },
  { id: 'lineage-graph', layer: 'CI', mode: 'hard', token: 'build-lineage-graph.mjs' },
  { id: 'cascade-validate', layer: 'CI', mode: 'hard', token: 'cascade-validate.mjs' },
  { id: 'ac-verify-map', layer: 'CI', mode: 'hard', token: 'ac-verify-map.mjs' },
  { id: 'semgrep-sast', layer: 'CI', mode: 'hard', token: 'semgrep' },
  { id: 'trufflehog-secrets', layer: 'CI', mode: 'hard', token: 'trufflehog' },
  { id: 'dependency-audit', layer: 'CI', mode: 'hard', token: 'dependency-audit' },
  { id: 'mutation-test', layer: 'CI', mode: 'hard', token: 'mutation-test' },
  { id: 'red-team', layer: 'CI', mode: 'hard', token: 'red-team.mjs' },
  { id: 'selftest-reality', layer: 'CI', mode: 'hard', token: 'gate:selftest' },
  // local pre-push — enforced on the machine that publishes (not checkable in CI: they compare
  // the repo against the LIVE install, which does not exist on a runner)
  { id: "ledger-sync-gate", layer: "local", mode: "hard", token: null },
  { id: "settings-integrity", layer: "local", mode: "hard", token: null },
  // PreToolUse — real-time, hard-block
  { id: 'policy-enforce-hook', layer: 'PreToolUse', mode: 'hard', token: null },
  { id: 'jidoka-guard', layer: 'PreToolUse', mode: 'hard', token: null },
  // runtime / dispatch — enforced by the orchestrator during a wave (not on commit)
  { id: 'budget-gate', layer: 'runtime', mode: 'hard', token: null },
  { id: 'policy-sandbox', layer: 'runtime', mode: 'proxy', token: null },
  { id: 'sandbox-run', layer: 'runtime', mode: 'kernel', token: null },
  { id: 'parallel-guard', layer: 'runtime', mode: 'hard', token: null },
  // product pre-push — enforced in the target product (via install-into), hard
  { id: 'northstar-check', layer: 'product', mode: 'hard', token: null },
  { id: 'charter-check', layer: 'product', mode: 'hard', token: null },
  { id: 'coverage-gate', layer: 'product', mode: 'hard', token: null },
  // runtime-coverage gates (built from real prod incidents) — enforced in the target product's CI
  { id: 'resource-guard', layer: 'product', mode: 'hard', token: null },
  { id: 'precision-guard', layer: 'product', mode: 'soft', token: null },
  { id: 'cross-layer-dup', layer: 'product', mode: 'hard', token: null },
  { id: 'req-trace', layer: 'product', mode: 'hard', token: null },
  { id: 'load-test-gate', layer: 'product', mode: 'hard', token: null },
  { id: 'canary-gate', layer: 'product', mode: 'hard', token: null },
  { id: 'e2e-run-gate', layer: 'product', mode: 'hard', token: null },
  { id: 'cost-ledger', layer: 'product', mode: 'hard', token: null },
  // soft-trial — warn until graduated (gate-graduation proposes the flip)
  { id: 'spec-drift', layer: 'product', mode: 'soft', token: null },
  { id: 'spec-frontmatter', layer: 'product', mode: 'soft', token: 'validate-spec-frontmatter.mjs' },
  { id: 'ac-coverage', layer: 'product', mode: 'soft', token: 'ac-coverage-check.mjs' },
  { id: 'spec-amendment', layer: 'product', mode: 'soft', token: 'spec-amendment-gate.mjs' },
  { id: 'change-ceremony', layer: 'product', mode: 'soft', token: 'change-ceremony.mjs' },
  { id: 'detect-injection', layer: 'runtime', mode: 'soft', token: null },
  { id: 'detect-constitutional-drift', layer: 'runtime', mode: 'soft', token: null },
  // LLM judges — measured via golden cases
  { id: 'constitutional-reviewer', layer: 'LLM', mode: 'measured', token: null },
  { id: 'reflexion-critic', layer: 'LLM', mode: 'measured', token: null },
  { id: 'debate-judge', layer: 'LLM', mode: 'measured', token: null },
  { id: 'best-of-N-judge', layer: 'LLM', mode: 'measured', token: null },
  { id: 'security-scanner', layer: 'LLM', mode: 'measured', token: null },
  { id: 'a11y-auditor', layer: 'LLM', mode: 'measured', token: null },
  { id: 'perf-profiler', layer: 'LLM', mode: 'measured', token: null },
  { id: 'coverage-auditor', layer: 'LLM', mode: 'measured', token: null },
  { id: 'debate-prosecutor', layer: 'LLM', mode: 'measured', token: null },
  { id: 'debate-defender', layer: 'LLM', mode: 'measured', token: null },
];

// a CI gate is "present" if its token appears in a workflow; selfTestOnly flags when its ONLY
// appearance is a --self-test invocation — the gate's LOGIC is CI-verified, but it does NOT enforce on
// the repo's real code. Present-but-self-test-only is surfaced (🟡), not failed — honest, not a ghost.
export function verifyCI(gates, workflowText) {
  const lines = String(workflowText).split('\n');
  return gates.filter(g => g.layer === 'CI').map(g => {
    if (!g.token) return { id: g.id, present: true, selfTestOnly: false };
    const hits = lines.filter(l => l.includes(g.token));
    return { id: g.id, present: hits.length > 0, selfTestOnly: hits.length > 0 && hits.every(l => l.includes('--self-test')) };
  });
}

// the INVERSE of a ghost: an ORPHAN — a gate script that exists (package.json "gate:*") but has NO
// standing caller (no workflow, no git hook). Built-but-unwired reads as protection while enforcing
// nothing. Incident that taught this: gate:selftest (wave-meta-gates) lived 3 days with zero callers
// while its commit claimed it "live + runnable" — declaration-over-implementation regression 2026-06-06.
// "Wired" = the script NAME is invoked somewhere (workflow / git hook), OR the FILE it runs is
// distributed to products by the installer (product-layer gates enforce in the target repo, not here).
export function findOrphanGateScripts(pkg, callersText) {
  const scripts = (pkg && pkg.scripts) || {};
  const names = Object.keys(scripts).filter(n => n.startsWith('gate:'));
  const text = String(callersText);
  return names.filter(n => {
    if (text.includes(n)) return false;
    const file = (String(scripts[n]).match(/[\w./-]+\.(?:mjs|js|sh)/) || [])[0];
    return !(file && text.includes(file.replace(/^.*\//, '')));
  });
}


// ── live-gate-must-map-to-remedy-class (2026-W33-K1) ─────────────────────────
// The forward axis of this file asks "does every declared gate actually run?". The REVERSE axis
// asks the question that was never asked: "does the learning registry know about every gate that
// runs?". On 2026-08-10 it did not. scripts/meta-remedies.mjs listed 8 classes; this map saw 62
// live gates; and the session-start digest told the owner "ungated — live risk: 15" while five of
// those fifteen were already closed by a wired, working mechanism (synthesis-coverage-gate,
// outbound-claims-gate, plus three product-side fixes). A third of the top risk signal was noise,
// which is worse than no signal: it buries the eight real holes among fifteen names.
//
// Why not just let the agent register the gate? Because meta-remedies.mjs is L0 and
// ALWAYS_PROTECTED on purpose: an agent that can register its own gate can also declare itself
// safe, which is the exact reward-hacking surface the registry exists to prevent. So the human
// paste stays. What changes is that the divergence is now DETECTED, the mechanism is PROVEN wired
// before anything is proposed, and the human gets a block to paste instead of a memory to keep.
//
// The routing claim (`@closes-class:`) is written by whoever writes the gate, so on its own it is
// only a claim — the same weak evidence as an anchor in a comment. It is paired with a WIRED check
// against the live hook/CI/git-hook config, so the pair says "this class is routed to this file,
// and this file really runs". Routing is declared; running is proven.
// The tag ends at the END OF ITS LINE. A character class containing \s would swallow the newline
// and glue the next line of code onto the class name — caught by the self-test on the first run.
const CLOSES_CLASS = /@closes-class:[ \t]*([^\r\n]+)/;
const CLASS_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Read `@closes-class: a, b` tags off mechanism files. Input: [{path, text}]. */
export function closesClassTags(files = []) {
  const out = [];
  for (const f of files) {
    const m = CLOSES_CLASS.exec(String(f.text || ''));
    if (!m) continue;
    const classes = m[1].split(',').map((s) => s.trim()).filter((s) => CLASS_SLUG.test(s));
    if (classes.length) out.push({ path: f.path, classes });
  }
  return out;
}

/**
 * Cross-check declared routing against the L0 registry and against what is really wired.
 *   pending — routed + wired + absent from the registry → hand the human a paste block
 *   unwired — routed but nothing calls the file → the tag is a claim with no gate behind it
 *   stale   — the registry names a mechanism that no file declares → the registry drifted
 * Pure. `wired` is a Set of file basenames known to have a standing caller.
 */
export function reverseRemedyAudit({ tags = [], remedies = {}, wired = new Set(), today = '', settingsAvailable = true } = {}) {
  const pending = [], unwired = [], unverifiable = [], declared = new Set();
  for (const t of tags) {
    const base = String(t.path).replace(/^.*\//, '');
    for (const cls of t.classes) {
      declared.add(cls);
      if (!wired.has(base)) {
        // Глобальные Stop/PreToolUse хуки подключаются в ~/.claude/settings.json, и этого
        // файла в CI нет и быть не может. Без него «вызывающий не найден» означает
        // «проверить нечем», а не «вызывающего нет». Раньше эти два состояния были
        // склеены, и CI краснел на условии, которое сервер физически не может выполнить,
        // ровно то, что этот же скрипт запрещает другим проверкам (severity parity).
        (settingsAvailable ? unwired : unverifiable).push({ cls, mechanism: t.path });
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(remedies, cls)) pending.push({ cls, mechanism: t.path, since: today });
    }
  }
  const stale = Object.entries(remedies)
    .filter(([cls, r]) => r && r.mechanism && !declared.has(cls))
    .map(([cls, r]) => ({ cls, mechanism: r.mechanism }));
  return { pending, unwired, unverifiable, stale };
}

// ONE definition of "which mechanisms exist" and "which of them are wired", shared by this tool and
// by the session digest. Two callers computing the same word from different inputs is how
// agent-eval-dashboard and judge-calibration-state ended up printing "10 of 11 measured" and
// "0 of 7 measured" about the same judges on the same day (2026-08-10). One word, one bar.
// extraDirs matters in the INSTALLED layout, where the live Stop/PreToolUse hooks live in
// ~/.claude/hooks and only some of them are mirrored into ~/.claude/jidoka/hooks. Scanning the repo
// layout alone under-counted the pending registrations 3 → 1 on the first live run.
export function collectMechanisms(root, { extraDirs = [] } = {}, read = readFileSync, list = readdirSync, exists = existsSync) {
  const files = [];
  const seen = new Set();
  const dirs = [...['hooks', 'scripts'].map((d) => ({ abs: join(root, d), label: d })), ...extraDirs.map((d) => ({ abs: d, label: 'hooks' }))];
  for (const { abs, label } of dirs) {
    if (!exists(abs)) continue;
    for (const f of list(abs)) {
      if (!/\.(mjs|js|sh)$/.test(f) || seen.has(f)) continue;
      seen.add(f);
      try { files.push({ path: `${label}/${f}`, text: read(join(abs, f), 'utf8') }); } catch { /* unreadable → skip */ }
    }
  }
  return files;
}

/** A mechanism is WIRED when some standing caller names its file. `callerTexts` are joined verbatim. */
export function wiredSetFrom(files = [], callerTexts = []) {
  const callers = callerTexts.filter(Boolean).join('\n');
  return new Set(files.map((f) => f.path.replace(/^.*\//, '')).filter((b) => callers.includes(b)));
}

/** Every text that can legitimately wire a mechanism: global hooks, CI, git hooks, npm scripts, installer. */
export function callerTexts(root, settingsRaw = '', read = readFileSync, exists = existsSync) {
  const readIf = (p) => { try { return read(p, 'utf8'); } catch { return ''; } };
  const ghDir = join(root, '.githooks');
  const gh = exists(ghDir) ? readdirSync(ghDir).map((f) => readIf(join(ghDir, f))).join('\n') : '';
  const pkgPath = join(root, 'package.json');
  const pkg = exists(pkgPath) ? readIf(pkgPath) : '';
  const wfDir = join(root, '.github', 'workflows');
  const wfs = exists(wfDir) ? readdirSync(wfDir).map((f) => readIf(join(wfDir, f))).join('\n') : '';
  // Периодические рутины — тоже ПОСТОЯННЫЕ вызывающие: routine-daily.sh запускает launchd
  // в 09:00 через ~/Library/LaunchAgents/com.mityamit.claude-daily-digest.plist →
  // hooks/daily-digest.sh → эта рутина. Раньше их здесь не было, и механизм, подключённый
  // ТОЛЬКО к рутине, читался как сирота, хотя он работает каждый день. Слепое пятно
  // вскрылось 2026-08-17 на pending-human.mjs.
  const scriptsDir = join(root, 'scripts');
  const routines = exists(scriptsDir)
    ? readdirSync(scriptsDir).filter((f) => /^routine-.*\.sh$/.test(f)).map((f) => readIf(join(scriptsDir, f))).join('\n')
    : '';
  return [settingsRaw, wfs, gh, pkg, routines, readIf(join(root, 'scripts', 'install-into.mjs'))];
}

/** Render the exact entries a human pastes into the L0 registry. Empty string when nothing pends. */
export function remedyPasteBlock(pending = []) {
  if (!pending.length) return '';
  return pending.map(({ cls, mechanism, since }) => `  '${cls}': {
    // since = the date the MECHANISM went live, not the date it was detected. ${since} is when this
    // block was generated; replace it with the real activation date or meta-trend's time-to-gate lies.
    since: '${since}',
    mechanism: '${mechanism}',
    family: [],
    gate: 'TODO: one sentence — what this mechanism refuses, in prose.',
  },`).join('\n');
}

// stop-layer-derived (2026-W31-R8) — the gate map called itself "the single map of every gate"
// and had no Stop layer at all, while four Stop hooks were live in settings.json:
// browser-verify-gate, proof-of-work-gate, outbound-claims-gate, synthesis-coverage-gate. A map
// that omits a whole enforcement layer is worse than no map: it is consulted and believed.
//
// The Stop layer is DERIVED from the hook config rather than typed here, so it cannot drift the
// way a hand-written list does. That is the same reason the README script counter kept going
// stale: a number a human maintains, guarding a property a machine could read.
//
// REJECTED half of this recommendation, with evidence. It also asked to "drop the unbacked
// measured claim for 10 judges". Checked on disk: all ten have docs/evals/<agent>/golden-cases.jsonl
// AND a recorded run-*.jsonl. The claim is backed, so it stays. Removing it would have deleted a
// true statement on the strength of a plausible-sounding report line.
export function stopGatesFrom(settingsText) {
  let cfg;
  try { cfg = JSON.parse(String(settingsText)); } catch { return { checked: false, gates: [] }; }
  const groups = cfg?.hooks?.Stop;
  if (!Array.isArray(groups)) return { checked: false, gates: [] };
  const gates = [];
  const seen = new Set();
  for (const g of groups) {
    for (const h of g.hooks || []) {
      const cmd = String(h.command || '');
      const file = (cmd.match(/([\w-]+)\.mjs\b/) || [])[1];
      if (!file || seen.has(file)) continue;
      seen.add(file);
      // a Stop hook that only records state is not a GATE; a gate is one that can block
      if (/^(session-state)$/.test(file)) continue;
      gates.push({ id: file, layer: 'Stop', mode: 'hard', token: `${file}.mjs` });
    }
  }
  return { checked: true, gates };
}

// PreToolUse gates are "wired" only if the GLOBAL hook config actually routes the right tools
// through them. Incident 2026-07-12 (gate-bypass): policy-enforce-hook handled Bash side-channels
// in code (self-tested, red-team-proven) but ~/.claude/settings.json ran it only on Write|Edit —
// the Bash write channel to L0 paths stayed open for weeks. Same anti-ghost idea as verifyCI:
// "enforced" must mean a standing caller routes the traffic, not that the logic exists.
export function verifyPreToolUse(settingsText) {
  let cfg; try { cfg = JSON.parse(String(settingsText)); } catch { return { checked: false, missing: [] }; }
  const groups = cfg?.hooks?.PreToolUse;
  if (!Array.isArray(groups)) return { checked: false, missing: [] };
  const routed = (tool, token) => groups.some(g => {
    const m = String(g.matcher ?? '');
    return (m === '*' || m.split('|').includes(tool)) && (g.hooks || []).some(h => String(h.command || '').includes(token));
  });
  const missing = [];
  for (const tool of ['Write', 'Edit', 'Bash']) {
    if (!routed(tool, 'policy-enforce-hook')) missing.push(`policy-enforce-hook not routed for ${tool} (the ${tool === 'Bash' ? 'side-channel' : 'write'} path is open)`);
  }
  // default-deny-write-tools (2026-W33-R5): the hook now treats an unknown tool as writing, but a
  // hook that is never invoked decides nothing. MCP servers are where unknown write verbs live, so
  // the MCP family must be routed too, or the default-deny is logic without a caller.
  const mcpRouted = groups.some((g) => {
    const m = String(g.matcher ?? '');
    return (m === '*' || /mcp__/.test(m)) && (g.hooks || []).some((h) => String(h.command || '').includes('policy-enforce-hook'));
  });
  if (!mcpRouted) missing.push('policy-enforce-hook not routed for mcp__* (every MCP server write verb bypasses the guard)');
  if (!routed('Bash', 'jidoka-guard')) missing.push('jidoka-guard not routed for Bash (secret-guard on push/commit is open)');
  return { checked: true, missing };
}

// gate-severity-parity (2026-W32-R1) — the same checker must be equally strict where you
// COMMIT and where you PUBLISH. When a script runs with a softening flag in .githooks/* but
// hard in .github/workflows/*, every commit passes locally and the failure surfaces only on
// the server, where nobody is watching. Not hypothetical: instantiation-audit ran --warn in
// .githooks/pre-commit and hard in ci.yml, main went red on 2026-07-29 over a one-line README
// count and stayed red five days while four more commits landed on top of it.
//
// A local gate MAY be stricter than CI. It may never be looser.
export const SOFTENING_FLAGS = ['--warn', '--soft', '--dry-run', '--advisory', '--no-fail'];

// Map script filename → is EVERY invocation of it softened? (a script invoked twice, once hard,
// counts as hard). --self-test invocations are skipped: they verify logic, they do not enforce.
function invocationSeverity(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const m = line.match(/scripts\/([\w.-]+\.mjs)(.*)$/);
    if (!m) continue;
    const script = m[1];
    const rest = m[2] || '';
    if (rest.includes('--self-test')) continue;
    const soft = SOFTENING_FLAGS.some(fl => rest.includes(fl));
    const prev = out.get(script);
    out.set(script, prev === undefined ? soft : prev && soft);
  }
  return out;
}

/**
 * Scripts that are SOFT locally but HARD in CI. Pure — takes the concatenated text of the
 * git hooks and of the workflows.
 */
export function findSeverityMismatches(hooksText = '', workflowsText = '') {
  const local = invocationSeverity(hooksText);
  const ci = invocationSeverity(workflowsText);
  const out = [];
  for (const [script, localSoft] of local) {
    if (!ci.has(script)) continue;          // not a shared checker — nothing to compare
    if (localSoft && !ci.get(script)) out.push(script);
  }
  return out.sort();
}

// ── FIFTH INVARIANT: a gate on the change path must cost in proportion to the change ──
// Origin: the owner, 2026-08-17, on projectx-app — "через Gate не нужно гонять все там.
// Ты там 2000 гоняешь файлов, 3000 все файлы, 1800 файлов и так далее." The rule itself was
// written 2026-07-27 (docs/GATES_MUST_SCALE_WITH_THE_CHANGE.md), implemented by hand in ONE
// project, and recurred three weeks later. A rule that lives only in prose is re-litigated
// every project; this makes it a checkable property of every mechanism, everywhere.
//
// The declaration alone would be a self-issued label (the class we closed on 2026-08-11), so
// the audit does not trust it: it DERIVES the scope a hook actually grants from the
// invocation line and fails on a mismatch. That half cannot be rubber-stamped. The `all`
// half can only be justified in writing, which keeps the cost visible rather than settled.
//
// `all` is not automatically wrong: meta-honesty reads ONE small ledger, settings-integrity
// reads ONE file. Cost is work volume, not repo size. What is forbidden is `all` that nobody
// had to justify, and a declaration that contradicts the invocation.
export const SCOPE_TAG = /@scope:[ \t]*(staged|changed|all)\b/;
export const SCOPE_OK = /@scope-ok:[ \t]*(\S[^\r\n]*)/;

/** Read `// @scope:` / `// @scope-ok:` off mechanism files. Input: [{path, text}]. Pure. */
export function scopeTags(files = []) {
  return files.map((f) => {
    const m = SCOPE_TAG.exec(f.text || '');
    const j = SCOPE_OK.exec(f.text || '');
    return { path: f.path, scope: m ? m[1] : null, justification: j ? j[1].trim() : null };
  });
}

/**
 * Which mechanisms a local git hook invokes, and with what arguments. Pure.
 * Returns Map<'scripts/x.mjs', argsString>.
 */
export function hookInvocations(hookText = '') {
  const out = new Map();
  const re = /node\s+"\$ROOT\/((?:scripts|hooks)\/[A-Za-z0-9._-]+\.mjs)"([^\n]*)/g;
  let m;
  while ((m = re.exec(hookText))) {
    const raw = m[2];
    const args = raw.replace(/;\s*rc=\$\?.*$/, '').replace(/2>&1/g, '');
    // A backgrounded invocation (`… &`) does not make the developer WAIT, but it still burns
    // the machine on every commit — which is the other half of the same 2026-08-17 complaint
    // ("из-за этого виснет весь компьютер"). So it is judged, and reported as background.
    const background = /&\s*$/.test(raw.replace(/#.*$/, '').trim());
    if (!out.has(m[1])) out.set(m[1], { args, background });
  }
  return out;
}

/**
 * The scope a hook ACTUALLY grants, read off the invocation rather than off the comment.
 * A shell variable passed as an argument is a file list; `$?` is an exit code, not a file.
 * Pure. Returns 'staged' | 'changed' | 'all'.
 */
export function derivedScope(args = '') {
  if (/--staged\b/.test(args)) return 'staged';
  if (/--changed\b/.test(args)) return 'changed';
  if (/--scope[= ]auto\b/.test(args)) return 'changed';
  if (/\$\{?[A-Za-z_][A-Za-z0-9_]*/.test(args)) return 'staged';
  return 'all';
}

/**
 * The invariant. Judges ONLY mechanisms standing on the change path (a local git hook),
 * because those are the ones whose cost is paid on every commit. Pure.
 * Returns { judged, undeclared, mismatched, unjustified }.
 */
export function scopeAudit({ files = [], hookText = '' } = {}) {
  const invocations = hookInvocations(hookText);
  const judged = [], undeclared = [], mismatched = [], unjustified = [];
  for (const f of scopeTags(files)) {
    if (!invocations.has(f.path)) continue;
    const { args, background } = invocations.get(f.path);
    const actual = derivedScope(args);
    if (!f.scope) { undeclared.push({ mechanism: f.path, actual, background }); continue; }
    judged.push({ ...f, actual, background });
    if (f.scope !== actual) mismatched.push({ mechanism: f.path, declared: f.scope, actual });
    else if (actual === 'all' && !f.justification) unjustified.push({ mechanism: f.path });
  }
  return { judged, undeclared, mismatched, unjustified };
}

function workflowsText(root = process.cwd()) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return '';
  return readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
}

function selfTest() {
  const wf = '...\n  run: npm run eval\n  run: node scripts/meta-audit.mjs\n  run: node scripts/execution-gate.mjs --self-test\n  uses: trufflesecurity/trufflehog\n  run: semgrep scan';
  const v = verifyCI([{ id: 'eval-suite', layer: 'CI', token: 'npm run eval' }, { id: 'semgrep-sast', layer: 'CI', token: 'semgrep' }, { id: 'ghost-gate', layer: 'CI', token: 'does-not-exist-xyz' }, { id: 'exec-st', layer: 'CI', token: 'execution-gate.mjs' }], wf);
  const by = Object.fromEntries(v.map(x => [x.id, x.present]));
  const stOnly = Object.fromEntries(v.map(x => [x.id, x.selfTestOnly]));
  const T = [
    ['GATES registry is non-trivial', GATES.length >= 20],
    ['every gate has a layer + mode', GATES.every(g => g.layer && g.mode)],
    ['a present CI gate verifies true', by['eval-suite'] === true],
    ['a token-matched CI gate (semgrep) verifies true', by['semgrep-sast'] === true],
    ['a GHOST CI gate (token absent) is caught', by['ghost-gate'] === false],
    ['a --self-test-only CI gate is flagged selfTestOnly (over-credit made visible)', stOnly['exec-st'] === true],
    ['a real-run CI gate is NOT flagged selfTestOnly', stOnly['eval-suite'] === false],
    ['layers cover CI/runtime/product/LLM/PreToolUse', new Set(GATES.map(g => g.layer)).size >= 5],
    ['soft gates are explicitly marked', GATES.some(g => g.mode === 'soft')],
    ['orphan gate:* script (no caller anywhere) is caught', findOrphanGateScripts({ scripts: { 'gate:x': 'node scripts/x.mjs' } }, 'run: npm test').includes('gate:x')],
    ['gate:* called by name (CI/hook) is NOT an orphan', findOrphanGateScripts({ scripts: { 'gate:x': 'node scripts/x.mjs' } }, 'run: npm run gate:x').length === 0],
    ['gate:* whose FILE ships via installer is NOT an orphan', findOrphanGateScripts({ scripts: { 'gate:x': 'node scripts/x.mjs' } }, "payload: 'x.mjs',").length === 0],
    ['no gate:* scripts → no orphans', findOrphanGateScripts({ scripts: { test: 'vitest' } }, '').length === 0],
    // verifyPreToolUse — the 2026-07-12 gate-bypass incident: hook logic fine, routing absent
    // stop-layer-derived (2026-W31-R8)
    ['Stop-гейты выводятся из живого конфига, а не из списка',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node ~/.claude/hooks/browser-verify-gate.mjs' }] }] } })).gates.length === 1],
    ['у выведенного гейта правильный слой',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node x/proof-of-work-gate.mjs' }] }] } })).gates[0].layer === 'Stop'],
    ['записыватель состояния не считается гейтом',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node x/session-state.mjs Stop' }] }] } })).gates.length === 0],
    ['не-mjs команда (звук) игнорируется',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'afplay done.wav' }] }] } })).gates.length === 0],
    ['дубль одного хука в двух группах не удваивает карту',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'a/x-gate.mjs' }] }, { hooks: [{ command: 'b/x-gate.mjs' }] }] } })).gates.length === 1],
    ['отсутствие Stop-секции это не проверено, а не пусто', stopGatesFrom(JSON.stringify({ hooks: {} })).checked === false],
    ['битый конфиг не роняет аудит', stopGatesFrom('{не json').checked === false],
    ['fully-routed PreToolUse config → no missing', verifyPreToolUse(JSON.stringify({ hooks: { PreToolUse: [
      { matcher: 'Bash', hooks: [{ command: 'jidoka-guard.sh' }, { command: 'node policy-enforce-hook.mjs' }] },
      // 2026-W33-R5 raised the bar: "fully routed" now includes the MCP family, because that is
      // where unknown write verbs live. The old fixture stopped being fully routed the day the
      // standard changed, which is exactly what this assertion is for.
      { matcher: 'Write|Edit|MultiEdit|NotebookEdit|mcp__.*', hooks: [{ command: 'node policy-enforce-hook.mjs' }] },
    ] } })).missing.length === 0],
    ['policy-enforce-hook absent from Bash matcher is caught (2026-07-12 incident)', verifyPreToolUse(JSON.stringify({ hooks: { PreToolUse: [
      { matcher: 'Bash', hooks: [{ command: 'jidoka-guard.sh' }] },
      { matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [{ command: 'node policy-enforce-hook.mjs' }] },
    ] } })).missing.some(m => m.includes('policy-enforce-hook not routed for Bash'))],
    ['a "*" matcher counts as routing every tool', verifyPreToolUse(JSON.stringify({ hooks: { PreToolUse: [
      { matcher: '*', hooks: [{ command: 'node policy-enforce-hook.mjs' }, { command: 'jidoka-guard.sh' }] },
    ] } })).missing.length === 0],
    ['malformed settings → checked:false, not a crash or a false alarm', verifyPreToolUse('{oops').checked === false],
    // findSeverityMismatches — the 2026-07-29 red-main incident: soft locally, hard in CI
    ['soft locally + hard in CI is caught (the exact incident shape)',
      findSeverityMismatches(
        'out=$(node "$ROOT/scripts/instantiation-audit.mjs" --warn 2>&1)',
        '      - run: node scripts/instantiation-audit.mjs',
      ).join() === 'instantiation-audit.mjs'],
    ['same severity both sides → clean',
      findSeverityMismatches('node "$ROOT/scripts/instantiation-audit.mjs"', '- run: node scripts/instantiation-audit.mjs').length === 0],
    ['stricter locally than CI is allowed, not flagged',
      findSeverityMismatches('node "$ROOT/scripts/x.mjs"', '- run: node scripts/x.mjs --warn').length === 0],
    ['a checker CI does not run at all is not a mismatch',
      findSeverityMismatches('node "$ROOT/scripts/local-only.mjs" --warn', '- run: node scripts/other.mjs').length === 0],
    ['--self-test invocations are ignored (logic check, not enforcement)',
      findSeverityMismatches('node "$ROOT/scripts/y.mjs" --warn', '- run: node scripts/y.mjs --self-test').length === 0],
    ['a second HARD local invocation clears the softened one',
      findSeverityMismatches('node "$ROOT/scripts/z.mjs" --warn\nnode "$ROOT/scripts/z.mjs"', '- run: node scripts/z.mjs').length === 0],
    ['empty inputs → no findings, no crash', findSeverityMismatches('', '').length === 0],

    // ── live-gate-must-map-to-remedy-class (2026-W33-K1) ────────────────────
    // The learning registry (scripts/meta-remedies.mjs) knew 8 classes while this map saw 62 live
    // gates, so the session-start digest kept printing "ungated — live risk" for classes that were
    // ALREADY closed: synthesis-coverage-gate, outbound-claims-gate and permission-gate were all
    // live and wired on 2026-08-10, and all three read as unprotected. Five of the fifteen risks the
    // owner saw every session were false. The registry is L0 and agent-writable-by-design-never, so
    // the fix is not "let the agent register itself" — it is to DETECT the divergence, prove the
    // mechanism is really wired, and hand the human a ready block to paste.
    ['a @closes-class tag is read off the mechanism',
      closesClassTags([{ path: 'hooks/x-gate.mjs', text: '// @closes-class: some-class\ncode' }])[0].classes[0] === 'some-class'],
    ['two classes on one tag line are both read',
      closesClassTags([{ path: 'hooks/x.mjs', text: '// @closes-class: a-class, b-class' }])[0].classes.length === 2],
    ['a file with no tag contributes nothing',
      closesClassTags([{ path: 'hooks/y.mjs', text: 'no tag here' }]).length === 0],
    ['tagged + wired + NOT in the registry → pending registration', (() => {
      const r = reverseRemedyAudit({
        tags: [{ path: 'hooks/synthesis-coverage-gate.mjs', classes: ['synthesis-shipped-without-coverage-audit'] }],
        remedies: {}, wired: new Set(['synthesis-coverage-gate.mjs']),
      });
      return r.pending.length === 1 && r.pending[0].cls === 'synthesis-shipped-without-coverage-audit' && r.unwired.length === 0;
    })()],
    ['tagged but NOT wired → the tag is a claim, not a gate (reported separately)', (() => {
      const r = reverseRemedyAudit({ tags: [{ path: 'hooks/ghost.mjs', classes: ['c'] }], remedies: {}, wired: new Set() });
      return r.unwired.length === 1 && r.pending.length === 0 && r.unverifiable.length === 0;
    })()],
    ['no global config (CI) → unwired becomes UNVERIFIABLE, never a violation', (() => {
      const r = reverseRemedyAudit({
        tags: [{ path: 'hooks/permission-gate.mjs', classes: ['c'] }],
        remedies: {}, wired: new Set(), settingsAvailable: false,
      });
      return r.unwired.length === 0 && r.unverifiable.length === 1 && r.unverifiable[0].mechanism === 'hooks/permission-gate.mjs';
    })()],
    ['the same input WITH a global config is still a hard violation (no weakening where it is checkable)', (() => {
      const r = reverseRemedyAudit({
        tags: [{ path: 'hooks/permission-gate.mjs', classes: ['c'] }],
        remedies: {}, wired: new Set(), settingsAvailable: true,
      });
      return r.unwired.length === 1 && r.unverifiable.length === 0;
    })()],
    ['a wired mechanism is unaffected by the config being absent', (() => {
      const r = reverseRemedyAudit({
        tags: [{ path: 'scripts/skills-freshness.mjs', classes: ['c'] }],
        remedies: {}, wired: new Set(['skills-freshness.mjs']), settingsAvailable: false, today: '2026-08-11',
      });
      return r.pending.length === 1 && r.unwired.length === 0 && r.unverifiable.length === 0;
    })()],
    ['tagged + wired + ALREADY registered → nothing to do', (() => {
      const r = reverseRemedyAudit({
        tags: [{ path: 'hooks/proof-of-work-gate.mjs', classes: ['declaration-over-implementation'] }],
        remedies: { 'declaration-over-implementation': { mechanism: 'hooks/proof-of-work-gate.mjs' } },
        wired: new Set(['proof-of-work-gate.mjs']),
      });
      return r.pending.length === 0 && r.unwired.length === 0 && r.stale.length === 0;
    })()],
    ['a registered class whose mechanism nothing declares → stale registration', (() => {
      const r = reverseRemedyAudit({ tags: [], remedies: { c: { mechanism: 'scripts/gone.mjs' } }, wired: new Set() });
      return r.stale.length === 1 && r.stale[0].cls === 'c';
    })()],
    ['a documented-only remedy (mechanism null) is NOT called stale', (() => {
      const r = reverseRemedyAudit({ tags: [], remedies: { c: { mechanism: null } }, wired: new Set() });
      return r.stale.length === 0;
    })()],
    ['the paste block names the class and its mechanism', (() => {
      const b = remedyPasteBlock([{ cls: 'my-class', mechanism: 'hooks/my-gate.mjs', since: '2026-08-10' }]);
      return b.includes("'my-class'") && b.includes('hooks/my-gate.mjs') && b.includes('2026-08-10');
    })()],
    ['no pending → no paste block at all', remedyPasteBlock([]) === ''],
    ['an mcp__ matcher satisfies the MCP routing check', (() => {
      const cfg = { hooks: { PreToolUse: [
        { matcher: 'Write|Edit|Bash', hooks: [{ command: 'node scripts/policy-enforce-hook.mjs' }] },
        { matcher: 'mcp__.*', hooks: [{ command: 'node scripts/policy-enforce-hook.mjs' }] },
      ] } };
      // asserts only the MCP axis — this config deliberately omits jidoka-guard, which is a
      // separate finding and must not mask the thing under test
      return !verifyPreToolUse(JSON.stringify(cfg)).missing.some((m) => /mcp__/.test(m));
    })()],
    ['no mcp__ matcher is reported as an open MCP write path', (() => {
      const cfg = { hooks: { PreToolUse: [
        { matcher: 'Write|Edit|Bash', hooks: [{ command: 'node scripts/policy-enforce-hook.mjs' }] },
      ] } };
      return verifyPreToolUse(JSON.stringify(cfg)).missing.some((m) => /mcp__/.test(m));
    })()],
    // ── fifth invariant: gate cost proportional to the change (owner, 2026-08-17) ──
    ['a @scope tag is read off the mechanism',
      scopeTags([{ path: 'scripts/x.mjs', text: '// @scope: staged\ncode' }])[0].scope === 'staged'],
    ['a mechanism with no @scope reads null (absent, not assumed)',
      scopeTags([{ path: 'scripts/x.mjs', text: 'code' }])[0].scope === null],
    ['a @scope-ok justification is read',
      scopeTags([{ path: 'scripts/x.mjs', text: '// @scope: all\n// @scope-ok: reads one small ledger' }])[0].justification === 'reads one small ledger'],
    ['hook invocations are parsed with their arguments',
      hookInvocations('out=$(node "$ROOT/scripts/a.mjs" --staged 2>&1)').get('scripts/a.mjs').args.includes('--staged')],
    ['a blocking invocation is not marked background',
      hookInvocations('out=$(node "$ROOT/scripts/a.mjs" 2>&1)').get('scripts/a.mjs').background === false],
    ['a backgrounded invocation is marked background (burns the machine, does not block)',
      hookInvocations('node "$ROOT/scripts/a.mjs" >/dev/null 2>&1 &').get('scripts/a.mjs').background === true],
    ['a background gate is still judged for scope',
      scopeAudit({ files: [{ path: 'scripts/a.mjs', text: 'code' }], hookText: 'node "$ROOT/scripts/a.mjs" &' }).undeclared.length === 1],
    ['a mechanism the hook never calls is absent from invocations',
      hookInvocations('out=$(node "$ROOT/scripts/a.mjs" 2>&1)').has('scripts/b.mjs') === false],
    ['--staged derives scope staged', derivedScope(' --staged ') === 'staged'],
    ['a passed file list derives scope staged', derivedScope(' $staged_mjs ') === 'staged'],
    ['--scope auto derives changed', derivedScope(' --scope=auto ') === 'changed'],
    ['no file argument derives scope all', derivedScope(' ') === 'all'],
    ['an exit-code $? is not mistaken for a file list', derivedScope('; rc=$?') === 'all'],
    ['a hook-path mechanism with no @scope is caught',
      scopeAudit({ files: [{ path: 'scripts/a.mjs', text: 'code' }], hookText: 'node "$ROOT/scripts/a.mjs" 2>&1' }).undeclared.length === 1],
    ['a mechanism OFF the change path is not judged at all',
      scopeAudit({ files: [{ path: 'scripts/b.mjs', text: 'code' }], hookText: 'node "$ROOT/scripts/a.mjs" 2>&1' }).undeclared.length === 0],
    ['a DECLARATION that contradicts the invocation is caught (cannot be rubber-stamped)',
      scopeAudit({ files: [{ path: 'scripts/a.mjs', text: '// @scope: staged' }], hookText: 'node "$ROOT/scripts/a.mjs" 2>&1' }).mismatched[0].actual === 'all'],
    ['a truthful staged declaration passes',
      scopeAudit({ files: [{ path: 'scripts/a.mjs', text: '// @scope: staged' }], hookText: 'node "$ROOT/scripts/a.mjs" --staged 2>&1' }).mismatched.length === 0],
    ['scope all with NO written justification is caught',
      scopeAudit({ files: [{ path: 'scripts/a.mjs', text: '// @scope: all' }], hookText: 'node "$ROOT/scripts/a.mjs" 2>&1' }).unjustified.length === 1],
    ['scope all WITH a justification passes (all is not automatically wrong)',
      scopeAudit({ files: [{ path: 'scripts/a.mjs', text: '// @scope: all\n// @scope-ok: one small ledger' }], hookText: 'node "$ROOT/scripts/a.mjs" 2>&1' }).unjustified.length === 0],
    ['an unjustified-but-mismatched gate is reported once, as the mismatch',
      scopeAudit({ files: [{ path: 'scripts/a.mjs', text: '// @scope: staged' }], hookText: 'node "$ROOT/scripts/a.mjs" 2>&1' }).unjustified.length === 0],
    ['empty inputs judge nothing', scopeAudit({}).judged.length === 0],
    ['a mechanism called ONLY from a periodic routine counts as wired (not an orphan)',
      wiredSetFrom([{ path: 'scripts/x.mjs' }], ['', '', '', '', 'node scripts/x.mjs']).has('x.mjs')],
    ['a mechanism nobody calls is still unwired',
      wiredSetFrom([{ path: 'scripts/x.mjs' }], ['', '', '', '', 'node scripts/other.mjs']).has('x.mjs') === false],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mgate-audit self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ gate-audit: gate map + CI-ghost detection correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const wf = workflowsText();
  const ci = verifyCI(GATES, wf);
  const ghosts = ci.filter(c => !c.present);
  // stop-layer-derived: the Stop gates come from the live hook config, never from a typed list.
  let settingsRaw = '';
  try { settingsRaw = readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'); } catch { /* no global config */ }
  const stop = stopGatesFrom(settingsRaw);
  const ALL = [...GATES, ...stop.gates];
  const byLayer = {};
  for (const g of ALL) (byLayer[g.layer] ??= []).push(g);
  console.log('gate-audit — map of all gates by enforcement layer\n');
  for (const [layer, gs] of Object.entries(byLayer)) {
    console.log(`  ${layer}:`);
    for (const g of gs) {
      const c = ci.find(c => c.id === g.id);
      const mark = g.layer === 'CI' ? (!c?.present ? '🔴 GHOST' : c.selfTestOnly ? '🟡 self-test-only' : '🟢') : (g.mode === 'soft' ? '🟡 soft' : g.mode === 'measured' ? '📊' : '🟢');
      console.log(`    ${mark} ${g.id} (${g.mode})`);
    }
  }
  const soft = ALL.filter(g => g.mode === 'soft').length;
  console.log(`\n  ${ALL.length} gates · ${ALL.filter(g => g.layer === 'CI').length} in CI · ${soft} soft-trial · ${ALL.filter(g => g.mode === 'measured').length} measured-LLM`);
  const selfTestOnly = ci.filter(c => c.selfTestOnly);
  if (selfTestOnly.length) console.log(`  \x1b[33mℹ ${selfTestOnly.length} CI gate(s) run ONLY as --self-test in CI (logic verified, NOT enforcing on repo code): ${selfTestOnly.map(g => g.id).join(', ')}\x1b[0m`);
  if (ghosts.length) { console.error(`\n\x1b[31m✗ ${ghosts.length} CI gate(s) declared but absent from workflows: ${ghosts.map(g => g.id).join(', ')}\x1b[0m`); process.exit(1); }
  console.log('  \x1b[32m✓ every CI-layer gate is present in a workflow (no ghost gate).\x1b[0m');
  // orphan check: every package.json gate:* script must have a standing caller (workflow or git hook)
  const pkgPath = join(process.cwd(), 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
  const hooksDir = join(process.cwd(), '.githooks');
  const hooksText = existsSync(hooksDir)
    ? readdirSync(hooksDir).map(f => { try { return readFileSync(join(hooksDir, f), 'utf8'); } catch { return ''; } }).join('\n')
    : '';
  const installerPath = join(process.cwd(), 'scripts', 'install-into.mjs');
  const installerText = existsSync(installerPath) ? readFileSync(installerPath, 'utf8') : '';
  const orphans = findOrphanGateScripts(pkg, wf + '\n' + hooksText + '\n' + installerText);
  if (orphans.length) { console.error(`\n\x1b[31m✗ ${orphans.length} gate script(s) built but UNWIRED (no workflow / git-hook caller — an orphan enforces nothing): ${orphans.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('  \x1b[32m✓ every gate:* script has a standing caller (no orphan gate).\x1b[0m');
  // severity parity: a checker that is soft locally and hard in CI guarantees a red server
  const mismatches = findSeverityMismatches(hooksText, wf);
  if (mismatches.length) {
    console.error(`\n\x1b[31m✗ ${mismatches.length} checker(s) SOFT in .githooks but HARD in CI: ${mismatches.join(', ')}\x1b[0m`);
    console.error('    Every commit passes locally and fails on the server. Match the severities');
    console.error('    (drop the softening flag locally, or soften CI deliberately and say why).');
    process.exit(1);
  }
  console.log('  \x1b[32m✓ no checker is softer locally than in CI (severity parity).\x1b[0m');
  // PreToolUse routing check: only meaningful on a machine with a global hook config (skipped in CI)
  const settingsPath = join(process.env.HOME || '', '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    const ptu = verifyPreToolUse(readFileSync(settingsPath, 'utf8'));
    if (ptu.checked && ptu.missing.length) {
      console.error(`\n\x1b[31m✗ PreToolUse gate(s) built but NOT ROUTED in ~/.claude/settings.json:\x1b[0m`);
      for (const m of ptu.missing) console.error(`    ${m}`);
      process.exit(1);
    }
    console.log('  \x1b[32m✓ PreToolUse hooks are routed for Write/Edit, Bash AND mcp__* (no unwired side-channel).\x1b[0m');
  } else {
    console.log('  \x1b[33mℹ no ~/.claude/settings.json here (CI) — PreToolUse routing not checkable, skipped honestly.\x1b[0m');
  }

  // ── reverse axis: does the LEARNING REGISTRY know about every gate that runs? ──
  const mechFiles = collectMechanisms(process.cwd());

  // ── fifth invariant: does every gate on the CHANGE PATH cost in proportion to the change? ──
  const sc = scopeAudit({ files: mechFiles, hookText: hooksText });
  if (sc.undeclared.length) {
    console.error(`\n\x1b[31m✗ ${sc.undeclared.length} mechanism(s) stand on the change path without declaring a scope:\x1b[0m`);
    for (const u of sc.undeclared) console.error(`    ${u.mechanism} — the hook grants it "${u.actual}"; add \`// @scope: ${u.actual}\``);
    console.error('    A gate whose cost nobody declared is the gate that gets bypassed (owner, 2026-08-17).');
    process.exit(1);
  }
  if (sc.mismatched.length) {
    console.error(`\n\x1b[31m✗ ${sc.mismatched.length} mechanism(s) DECLARE a scope the invocation contradicts:\x1b[0m`);
    for (const m of sc.mismatched) console.error(`    ${m.mechanism} declares "${m.declared}" but the hook grants it "${m.actual}"`);
    console.error('    The declaration is not evidence — the invocation is. Fix one of the two.');
    process.exit(1);
  }
  if (sc.unjustified.length) {
    console.error(`\n\x1b[31m✗ ${sc.unjustified.length} whole-repo gate(s) on the change path with no written justification:\x1b[0m`);
    for (const u of sc.unjustified) console.error(`    ${u.mechanism} — add \`// @scope-ok: <why the whole repo, in one line>\``);
    process.exit(1);
  }
  const wide = sc.judged.filter((j) => j.actual === 'all');
  console.log(`  \x1b[32m✓ scope declared for all ${sc.judged.length} change-path gate(s); ${wide.length} run wide, each justified in writing.\x1b[0m`);
  for (const w of wide) console.log(`      ${w.path}${w.background ? ' (в фоне)' : ''} — ${w.justification}`);
  const tags = closesClassTags(mechFiles);
  const wired = wiredSetFrom(mechFiles, callerTexts(process.cwd(), settingsRaw));
  let REMEDIES = {};
  try { ({ REMEDIES } = await import('./meta-remedies.mjs')); } catch { /* registry unreadable → report nothing rather than guess */ }
  const today = new Date().toISOString().slice(0, 10);
  const rev = reverseRemedyAudit({ tags, remedies: REMEDIES, wired, today, settingsAvailable: settingsRaw !== '' });

  console.log(`\n  reverse axis — ${tags.length} mechanism(s) declare a class, registry knows ${Object.keys(REMEDIES).length}`);
  if (rev.unwired.length) {
    console.error(`\n\x1b[31m✗ ${rev.unwired.length} mechanism(s) CLAIM a class but nothing calls them:\x1b[0m`);
    for (const u of rev.unwired) console.error(`    ${u.mechanism} claims "${u.cls}" — a tag with no standing caller protects nothing`);
    process.exit(1);
  }
  if (rev.unverifiable.length) {
    // Не «всё хорошо» и не «нарушение»: непроверяемое названо непроверяемым.
    console.log(`  \x1b[33mℹ ${rev.unverifiable.length} mechanism(s) whose only possible caller is ~/.claude/settings.json — not checkable here (no global config, i.e. CI):\x1b[0m`);
    for (const u of rev.unverifiable) console.log(`    ${u.mechanism} claims "${u.cls}"`);
    console.log('    On a machine WITH the global config this same check is hard-blocking; run it there to verify.');
  }
  if (rev.stale.length) {
    console.log(`  \x1b[33mℹ ${rev.stale.length} registered class(es) whose mechanism declares nothing: ${rev.stale.map((s) => s.cls).join(', ')}\x1b[0m`);
    console.log('    Either the file moved, or it should carry `// @closes-class: <slug>`.');
  }
  if (rev.pending.length) {
    console.log(`\n  \x1b[33m⚠ ждут регистрации: ${rev.pending.length}\x1b[0m — live, wired, and INVISIBLE to the learning metrics.`);
    console.log('    Until a human pastes these, meta-trend under-counts gate coverage and the');
    console.log('    session digest calls these classes "ungated — live risk" when they are not.');
    for (const p of rev.pending) console.log(`      ${p.cls}  ←  ${p.mechanism}`);
    console.log('\n    Paste into scripts/meta-remedies.mjs (L0 — human edit by design), before the closing };\n');
    console.log(remedyPasteBlock(rev.pending));
    // The paste block has been printed every run for seven days and pasted zero times
    // (measured 2026-08-17). Printing is not a queue: it has no age and no counter, so the
    // overdue human step stays invisible. Hand it to one, opt-in so CI stays read-only.
    if (process.argv.includes('--emit-pending')) {
      const { loadLedger: loadPending, upsertRows, saveLedger: savePending } = await import('./pending-human.mjs');
      const rows = rev.pending.map((pnd) => ({
        id: `register-class:${pnd.cls}`,
        what: `вставить блок регистрации класса "${pnd.cls}" в scripts/meta-remedies.mjs`,
        why: 'гейт работает, но метрики его не видят: сводка зовёт класс живым риском, meta-trend занижает покрытие',
        source: `gate-audit#reverseRemedyAudit ← ${pnd.mechanism}`,
        since: pnd.since || today,
      }));
      const before = loadPending(process.cwd());
      savePending(upsertRows(before, rows), process.cwd());
      console.log(`\n  \x1b[33m→ ${rows.length} шаг(ов) поставлено в очередь человеку: node scripts/pending-human.mjs\x1b[0m`);
    }
  } else {
    console.log('  \x1b[32m✓ every live, wired gate is known to the learning registry (no invisible gate).\x1b[0m');
  }
  process.exit(0);
}
