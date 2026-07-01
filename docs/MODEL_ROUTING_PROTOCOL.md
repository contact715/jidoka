# Model Routing Protocol

## Purpose
- Use Claude Fable 5 for the hardest judgment work.
- Use Codex GPT-5.5 for local execution, integration, tools, and proof.
- Keep Jidoka intact: no known defect moves to the next station.

## Default Split
- Fable 5: architecture, root-cause investigation, ambiguous scope, long-horizon planning, high-risk review.
- Codex 5.5: code edits, terminal/browser work, tests, builds, UI verification, final evidence.

## Route Command
```bash
node scripts/jidoka.mjs model-route --task-text "<task>" --json
```

## Automatic Intake
- Run the route command for every non-trivial development request.
- If `automation.autoRelay` is `true`, use `relay auto`.
- If `automation.mode` is `direct-codex`, keep the task in the current Codex session.
- If `automation.mode` is `redact-then-relay`, redact sensitive material before any Fable handoff.
- Do not require the user to say "use Jidoka" or "use Fable".

## Routes
- `codex-execute`: Codex implements locally and verifies.
- `fable-plan`: Fable creates the plan/investigation packet; Codex executes approved chunks.
- `fable-review`: Fable reviews high-risk work; Codex applies accepted fixes and verifies.
- `codex-then-fable-review`: Codex implements a clear task, then prepares a Fable review packet before closure.
- `codex-redact-first`: Codex handles privacy-sensitive material locally and redacts before any external handoff.

## Fable 5 Triggers
- Architecture or system design decisions.
- Large migrations, rewrites, or cross-module refactors.
- Root-cause analysis for unclear incidents, regressions, flaky behavior, races, or memory leaks.
- Systemic design drift, guardrail, "never again", or self-learning process fixes.
- Strategy, roadmap, trade-off analysis, ADR/RFC drafting.
- Adversarial review of security, auth, billing, PII, public API contracts, or broad diffs.

## Codex 5.5 Triggers
- Clear implementation tasks.
- Tests, lint, build, CI, Playwright, dev server, browser verification.
- UI wiring, components, styling, API integration.
- Mechanical refactors, renames, formatting, dead-code cleanup.
- Applying accepted Fable recommendations and collecting proof.

## Handoff Rules
- Do not claim Fable ran unless a real Fable handoff/review happened.
- If no Fable tool is available, prepare the handoff packet and continue only when risk is acceptable.
- Redact secrets, credentials, customer data, PII, and regulated data before any Fable handoff.
- Fable recommendations are not done work; Codex still owns edits, tests, and final evidence.
- A Fable timeout is not a Fable handoff. If relay status has `claude-timed-out`, report Codex fallback explicitly and continue only from local inspection plus the original task.
- A Codex timeout is a failed relay run. Do not claim implementation or proof completed.

## Relay Timeouts
- Default Fable/Claude timeout: `240000ms`.
- Default Codex timeout: `600000ms`.
- Override with relay flags `--claude-timeout-ms N` and `--codex-timeout-ms N`, or environment variables `JIDOKA_CLAUDE_TIMEOUT_MS` and `JIDOKA_CODEX_TIMEOUT_MS`.
- Watchers must be restarted after timeout changes.

## Templates
- Plan/investigation handoff: `docs/templates/FABLE_HANDOFF.md`
- Review handoff: `docs/templates/FABLE_REVIEW.md`
