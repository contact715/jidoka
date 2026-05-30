---
status: Active
version: 1.0.0
level: L1
type: core-arch
owner_role: platform
parents:
  - path: docs/MISSION.md
    version: 1.0.0
    relationship: implements
  - path: docs/PRODUCT_PHILOSOPHY.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-05-27
last_validated_against_parents: 2026-05-27
last_updated: 2026-05-27
---

# Multi-Level Verification System — this project Dev Environment

**Status:** Active (wave-103)
**Level:** L1 — Core Architecture
**Companion:** `docs/AGENT_ROSTER.md` (L0.96 + L0.97), `docs/CODING_STANDARDS.md`, `docs/AGENT_LAYER_QUALITY_SPEC.md`

---

## 0. Overview

Verification pipeline applied to every wave. Four tiers escalate from automated checks → human review when needed. Designed для "set-and-forget" autonomous loop where AI agents complete waves correctly without manual intervention until a genuine human-required decision arises.

Industry references:
- **Multi-Agent Debate** (Liang et al. 2023, MIT) — adversarial reasoning improves correctness
- **OpenAI Process Reward Models** — step-by-step eval, not just final outcome
- **AlphaCode parallel sampling** — Best-of-N with judge selection
- **Anthropic Constitutional AI** (Bai et al. 2022) — critique-revise-verify loop
- **Self-Consistency** (Wang et al. 2022) — N samples + majority vote
- **Spotify squad model** — full-stack autonomous teams с clear escalation paths

---

## 1. Tier 1 — Automated checks (every commit, parallel)

**Owner:** husky `post-commit` hook + `scripts/run-tier-1-checks.mjs`

Runs in parallel, < 60 seconds total:

| Check | Tool | Block condition |
|---|---|---|
| TypeScript | `npx tsc --noEmit --skipLibCheck` | Any error |
| Lint | `npm run lint` | Any `error` (warnings allowed) |
| Unit tests | `npm test` via test-runner | Any failing test |
| Coverage delta | `scripts/coverage-delta.mjs` | > 5% drop per file |
| Bundle delta | `scripts/bundle-delta.mjs` | > 50 KB growth per route |
| Accessibility | `scripts/run-quality-gates.mjs` axe-runner | Serious/critical violation |
| Security | `scripts/run-quality-gates.mjs` security-scanner | High/critical finding |

**Failure routing:**
- Single failing check → **debug-agent** (auto-fix if < 20 LOC + ≥ 80% confidence)
- Multiple failures OR auto-fix declined → escalate Tier 2

**Output:** `docs/metrics/verification-wave-NN.json` (structured report)

---

## 2. Tier 2 — Specialist verification (per wave)

**Owner:** `scripts/run-tier-2-checks.mjs`, dispatched after Tier 1 passes

Runs sequentially с iteration cap **5** (was 2 before wave-103):

| Specialist | Role | Block condition |
|---|---|---|
| **reflexion-critic** | 3 gates (BLOCKERS / CONCERNS / NITS) against spec | Any BLOCKER |
| **constitutional-reviewer** | Mission Compass Q1-Q5 + PHILOSOPHY check | Any Q FAIL |
| **visual-qa** | Screenshots vs spec ACs (UI waves only) | Visual regression |
| **integration-tester** | E2E user journeys (Playwright) | Any flow failure |

**Smart routing on REVISE:**
- Test failure → **test-engineer** (rewrite test) OR **debug-agent** (fix impl)
- Impl gap → **frontend-agent** (extend)
- Spec ambiguity → **chief-architect** (revise spec)
- Constitutional violation → invoke `.claude/skills/constitutional-revision.md` (critique-revise loop, cap 3)

**Iteration accounting:**
- Each REVISE cycle counted
- At 5 iterations: auto-escalate Tier 3 (debate) OR Tier 4 (human) depending on nature

**Note:** Reflexion Critic's own internal cap (2 rounds) — unchanged. Тier 2 outer cap (5 cycles) — different concept, governs всю Tier 2 escalation.

---

## 3. Tier 3 — Adversarial Debate (high-stakes only)

**Owner:** `lib/verification/debate-engine.mjs`, dispatched when triggers fire

### Triggers (any one activates)

1. **L effort wave** (spec marks `effort: L`)
2. **Security-critical change** (touches `lib/auth/`, OAuth, secrets, `.sdd-config.json`)
3. **Mission Compass concern** (constitutional-reviewer emitted WARN или AMBIGUOUS, не VIOLATION)
4. **Billing/payment changes** (any commit в `billing/`, `settings/billing/`, Stripe lib)
5. **Manual escalation** (orchestrator opt-in via spec frontmatter `force_debate: true`)

### Protocol — 3 rounds

**Round 1: Opening**
- **debate-prosecutor** states case: "This change has bugs / security issues / spec violations / Mission misalignment because X, Y, Z"
- **debate-defender** states defense: "This change is correct; X is mitigated by A, Y by B, Z by C"

**Round 2: Cross-examination**
- Each side challenges other's evidence
- Specific file:line citations required
- No new arguments — refine existing

**Round 3: Closing**
- Each side summarizes strongest 3 points
- No new evidence

### Verdict (debate-judge)

| Verdict | Action |
|---|---|
| **PASS** | Both sides agreed, OR judge favors defender with high confidence → merge allowed |
| **REVISE** | Specific fixes needed, return to Tier 2 with judge's notes |
| **BLOCK** | Fundamental issues, return to chief-architect |
| **DEADLOCK** | Equal evidence, escalate Tier 4 (human decides) |

### Multimodal evidence

debate-judge has access:
- Full diff (text)
- Screenshots (if UI change — invokes visual-qa)
- Test results (Tier 1 + Tier 2 outputs)
- Audit log entries
- Voice transcripts (для voice agent changes)

### Best-of-N variant (opt-in)

For critical waves, spec frontmatter `parallel_implementations: 3` triggers:
- N=3 parallel frontend-agents in git worktrees
- Each writes к branch `wave-NN-attempt-1`, `attempt-2`, `attempt-3`
- **best-of-N-judge** compares attempts on 5 metrics:
  - LOC efficiency
  - Test coverage delta
  - Performance impact (bundle, runtime)
  - Spec AC compliance score
  - Code quality (lint, complexity)
- Winner merged, losers archived в `docs/debates/wave-NN-bestofN.md`

### Transcript

Saved к `docs/debates/wave-NN-debate.md`:
- Round-by-round dialogue
- Judge's reasoning
- Verdict с rationale

500 KB truncation guard — content beyond goes to gitignored `.claude/debates/wave-NN-debate-full.md`

---

## 4. Tier 4 — Human escalation

**Triggers (auto, any one):**

| Trigger | Source |
|---|---|
| Mission Compass FAIL (post Tier 2 + constitutional-revision loop exhausted) | constitutional-reviewer |
| Cost ceiling > 110% monthly LLM budget | `.sdd-config.json` budget check |
| Tier 3 DEADLOCK verdict | debate-judge |
| HumanOnlyDecisionRegistry hit (wave-78) | approval engine |
| Security HIGH finding (Tier 1) | security-scanner |
| 5-iteration cap exhausted (Tier 2) | run-tier-2-checks.mjs |

**Notification channels:**
- Terminal alert (always)
- Slack/Telegram webhook (if `.sdd-config.json` has webhook URL)
- GitHub issue draft (auto-created via gh CLI if available)

**Resume behavior:**
- Pipeline pauses, не proceeds to merge
- Human action (commit с `Closes: <issue-id>` OR explicit override commit) resumes
- All escalations logged к `docs/audit-reports/tier-4-escalations.md`

---

## 5. Pipeline orchestration

**Entry point:** `scripts/run-verification-pipeline.mjs`

Called by:
- Post-commit hook (async, every commit)
- Pre-merge hook (sync, blocks merge until verdict)
- Manual: `npm run verify --wave=NN`

### Sequence (per wave)

```
Commit lands
  ↓
post-commit hook → run-tier-1-checks (parallel, ~60s)
  ↓
  ├─ PASS → run-tier-2-checks (sequential, 5-15min depending on wave)
  │           ↓
  │           ├─ PASS → check Tier 3 triggers
  │           │           ↓
  │           │           ├─ no trigger → ready for merge
  │           │           └─ trigger fires → run debate-engine (Tier 3, 5-15min)
  │           │                                ↓
  │           │                                ├─ PASS → ready for merge
  │           │                                ├─ REVISE → loop back Tier 2
  │           │                                ├─ BLOCK → escalate Tier 4
  │           │                                └─ DEADLOCK → escalate Tier 4
  │           │
  │           └─ REVISE → smart routing → fix → re-run Tier 2 (cap 5)
  │
  └─ FAIL → debug-agent (auto-fix < 20 LOC) OR escalate Tier 2
```

### Hooks integration

```
.husky/pre-commit
  - cascade-validate (wave-117 — hierarchical specs)
  - INDEX/COVERAGE regen (wave-95)

.husky/commit-msg
  - AC traceability check (wave-95)
  - wave-artifact validation

.husky/post-commit
  - SDD memory sync (wave-95)
  - Bypass logging when hard-block active (wave-95)
  - **Verification pipeline async dispatch (wave-103)**

.husky/pre-merge
  - **Tier 1 + Tier 2 quality gates (wave-102 + wave-103)**
  - **Block on Tier 3 unresolved verdict (wave-103)**
```

---

## 6. Output artifacts per wave

| Artifact | Location | Purpose |
|---|---|---|
| Tier 1 report | `docs/metrics/verification-wave-NN.json` | Raw automated check results |
| Tier 2 report | `docs/metrics/verification-tier-2-wave-NN.json` | Specialist iteration log |
| Debate transcript | `docs/debates/wave-NN-debate.md` | If Tier 3 fired |
| Best-of-N comparison | `docs/debates/wave-NN-bestofN.md` | If parallel_implementations |
| Pipeline summary | `docs/metrics/verification-pipeline-wave-NN.json` | Full audit trail end-to-end |
| Tier 4 escalation log | `docs/audit-reports/tier-4-escalations.md` | Cumulative log of human-required handoffs |

---

## 7. Known limitations

1. **`.husky/pre-merge`** fires only on local `git merge` — NOT on GitHub PR UI merges. Workaround: run `npm run verify` manually before clicking merge OR adopt GitHub Actions equivalent.
2. **debate-engine** requires LLM API calls — adds 2-5 minutes per Tier 3 invocation. Cost: ~$0.50-2.00 per debate (mitigated by triggers being narrow).
3. **Best-of-N** uses `git worktree` — requires git ≥ 2.5. Mac/Linux default works; Windows users may need WSL2.
4. **Self-consistency** budget guard — skips sampling если within 10% of monthly LLM budget ceiling. Returns "medium confidence" fallback instead of high.
5. **Tier 3 transcripts** truncated at 500 KB — full version в gitignored `.claude/debates/`.

---

## 8. Configuration

`.sdd-config.json`:

```json
{
  "hard_block_ac": false,                    // wave-95 — hard block AC traceability
  "debate_triggers": {                        // wave-103 — Tier 3 activation
    "l_effort": true,
    "security_critical": true,
    "mission_compass_concern": true,
    "billing_payment": true
  },
  "iteration_caps": {
    "tier_2": 5,                              // outer routing cap
    "reflexion_critic": 2,                    // unchanged from wave-102
    "constitutional_revision": 3              // wave-103
  },
  "budget": {
    "monthly_llm_usd": 500,
    "tier_4_threshold_pct": 110               // human escalation at 110% of budget
  },
  "webhooks": {
    "slack": null,
    "telegram": null,
    "github_issue": true                       // gh CLI integration
  }
}
```

---

## 9. Evolution log

- **Wave-102:** L0.96 Quality Gates layer (10 agents) — Tier 1 + Tier 2 foundation
- **Wave-103:** L0.97 Adversarial layer (4 agents: debate-prosecutor/defender/judge + best-of-N-judge) + 4-tier orchestration
- **Wave-104 (planned):** Multimodal verification stack (vision/audio cross-validation)
- **Wave-105 (planned):** this project product agent integration (Verifier Agent §6.1 wiring)
- **Wave-106 (planned):** Red Team agent + Process Reward Model
- **Wave-107 (planned):** Self-consistency expansion + Constitutional auto-loop full integration

---

## 10. Anti-patterns

| Don't | Why |
|---|---|
| Trigger Tier 3 on every wave | Cost prohibitive ($10+ per wave); reserve for high-stakes |
| Skip Tier 1 to save time | Tier 1 catches 80% of issues at < 1 min cost |
| Override Tier 4 escalations silently | Lose audit trail; defeats safety guarantee |
| Run Best-of-N without git worktree support | Sequential branch checkout pollutes working tree |
| Set hard_block_ac=true on day 1 | Existing 25+ wave commits лacking AC refs will block; graduate after 30-day soft trial |
| Treat reflexion-critic and constitutional-reviewer as redundant | They check orthogonal axes: spec compliance vs principle alignment |
