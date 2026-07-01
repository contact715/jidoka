# Agent Instructions

## Jidoka Always On
- These are global Codex instructions loaded from `~/.codex/AGENTS.md`.
- Jidoka applies to every Codex task, in every project.
- Higher-priority Codex/system/developer instructions still win.
- Jidoka is a quality process, not a permission bypass.

## Core Rule
- Built-in quality: never pass a known defect to the next station.
- Stop on active halt states, hard gate failures, unsafe uncertainty, or unverified completion claims.
- Fix the root cause before continuing; do not hide failures with skipped tests, disabled rules, widened `any`, fake snapshots, or documentation-only closure.

## Target First
- Before non-trivial work, classify the target:
- `project`: product code or product-specific docs in the current repository.
- `framework`: reusable Jidoka agents, skills, scripts, gates, hooks, installers, global instructions.
- `global`: `~/.codex`, `~/.claude`, shell hooks, local machine bootstrap.
- If the target is ambiguous, ask one short question before editing.

## Framework Locations
- Prefer the nearest project-local install:
- `.jidoka/scripts/`
- `scripts/` when the current repo itself is Jidoka or already contains the framework engine.
- Fallback global mirror:
- `~/.codex/jidoka/scripts/`
- `~/.codex/jidoka/docs/`
- `~/.codex/jidoka/skills/`
- Source repository on this machine:
- `__JIDOKA_FRAMEWORK_ROOT__/`

## Start Of Work
- Read the local `AGENTS.md` if present; local rules specialize these global rules.
- Check git state before edits:

```bash
git status --short
```

- Check for active halt state before meaningful changes:

```bash
test -f .sdd-halt-state.json && sed -n '1,220p' .sdd-halt-state.json || true
test -f docs/audits/andon-halt.json && sed -n '1,220p' docs/audits/andon-halt.json || true
test -f .jidoka/andon-halt.json && sed -n '1,220p' .jidoka/andon-halt.json || true
```

- If a halt is active, stop and surface the resume command. Do not auto-resume.

## Proportional Process
- Tiny task: inspect, edit, run the smallest proof.
- Non-trivial task: read specs/docs first, identify owners, plan briefly, implement, verify.
- Architecture/product/system task: run holistic analysis before incremental work.
- Irreversible or broad change: pre-mortem first.

## Automatic Intake
- The user does not need to say "use Jidoka", "use relay", or "use Fable".
- For every non-trivial development request, classify the task before implementation:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs model-route --task-text "<task>" --json
```

- If `automation.autoRelay` is `true`, run the one-window relay automatically:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs relay auto --cwd "$PWD" --from codex --task "<task>" --allow-codex-write
```

- If `automation.mode` is `direct-codex`, continue in the current Codex session.
- If `automation.mode` is `redact-then-relay`, redact or summarize sensitive material locally before any Fable handoff.
- Do not run the relay recursively when already inside a relay worker prompt.

## Model Routing
- Use the two-model Jidoka cell:
- Claude Fable 5: architecture, root-cause investigation, ambiguous scope, long-horizon planning, high-risk review.
- Codex GPT-5.5: local implementation, terminal/browser verification, integration, final proof.
- Route non-trivial or high-risk work with the nearest available engine:

```bash
node scripts/jidoka.mjs model-route --task-text "<task>" --json
node .jidoka/scripts/jidoka.mjs model-route --task-text "<task>" --json
node ~/.codex/jidoka/scripts/jidoka.mjs model-route --task-text "<task>" --json
```

- `fable-plan`: prepare a Fable handoff packet, then Codex executes approved chunks.
- `fable-review`: prepare a Fable review packet, then Codex applies accepted fixes and verifies.
- `codex-execute`: Codex owns implementation and proof.
- `codex-then-fable-review`: Codex implements, then requests Fable review before closure.
- `codex-redact-first`: redact secrets, credentials, PII, and regulated data before any external handoff.
- Use `docs/MODEL_ROUTING_PROTOCOL.md` or `~/.codex/jidoka/docs/MODEL_ROUTING_PROTOCOL.md`.
- Use `docs/templates/FABLE_HANDOFF.md` and `docs/templates/FABLE_REVIEW.md` when available.
- Do not claim Fable ran unless a real Fable handoff or review happened.

## Local Relay
- For no-API coordination between open Claude Code and Codex sessions, use the local file relay.
- Queue location: `~/.jidoka/relay`.
- Protocol: `docs/LOCAL_RELAY_PROTOCOL.md` or `~/.codex/jidoka/docs/LOCAL_RELAY_PROTOCOL.md`.
- Start watchers:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs relay start-watchers --allow-codex-write
```

- Submit a task from any repo:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs relay auto --cwd "$PWD" --from codex --task "<task>" --allow-codex-write
```

- The relay writes prompts, outputs, and status under `~/.jidoka/relay/runs/<run-id>/`.
- If the user wants one-window work, run `relay auto`; do not ask them to switch between Claude and Codex.
- Relay defaults: Fable/Claude timeout `240000ms`, Codex timeout `600000ms`. Override with `--claude-timeout-ms`, `--codex-timeout-ms`, `JIDOKA_CLAUDE_TIMEOUT_MS`, or `JIDOKA_CODEX_TIMEOUT_MS`; restart watchers after changes.
- If Fable times out, relay records `claude-timed-out` and queues Codex fallback with `phase: codex-after-fable-timeout`. Do not claim Fable produced a plan/review; say Codex continued locally from the original task and repo inspection.
- If Codex times out, relay records `codex-timed-out` and marks the run failed. Do not claim implementation or proof completed.

## Before Building
- Reuse before build: search for existing owners with `rg`, local docs, and project registries.
- Spec before code in spec-driven repos:

```bash
node scripts/get-spec-context.mjs --feature <keyword>
```

- If only `.jidoka/scripts/get-spec-context.mjs` exists, use that path.
- Read the controlling spec and parent chain before product code.
- Do not create a parallel structure when an owner exists.

## Verification
- Choose the smallest executable proof that demonstrates the change.
- Common checks:

```bash
npx tsc --noEmit
npm run lint
npm run test
npm run build
```

- In Jidoka repos, prefer available engine checks:

```bash
npm run test:engine
npm run eval
node scripts/jidoka.mjs --self-test
```

- UI work requires rendered/browser verification when feasible.
- Security/auth/billing/PII changes require stronger checks and explicit residual risk.

## Completion
- Before saying "done", name:
- what changed
- what proof ran
- what remains open
- A task is not complete if the only enforcement is documentation.
- If verification cannot run, say exactly why.

## Skills
- If local `.claude/skills/` exists, read the triggered skill before acting.
- If no local skills exist, use `~/.codex/jidoka/skills/` as the Jidoka fallback.
- Common triggers:
- `root-cause-over-patch`: failures, crashes, user-reported bugs.
- `adversarial-self-review`: before done claims or commits over 30 LOC.
- `completion-audit`: before "done", "shipped", "complete", or "fixed".
- `proportional-process`: before choosing a heavy pipeline.
- `proactive-holistic-analysis`: whole-system, state-of-the-art, architecture, "think through".
- `surface-audit-before-touch`: visible UI edits.
- `rendered-verification`: UI-touching changes.
- `tdd-flow`: testable acceptance criteria, stores, transformers, validation logic.

## Commit Attribution
AI commits MUST include:

```text
Co-Authored-By: Codex <codex@openai.com>
```
