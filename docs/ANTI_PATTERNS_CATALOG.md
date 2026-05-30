# Anti-Patterns Catalog

> Canonical reference for documented failure patterns in this project dev system.
> Each entry: trigger conditions, prevention rule, memory MCP entity, session history, escalation path.
>
> Maintained by: wave-145 (initial 7 entries). Append new entries when meta-process-auditor emits CATALOG_UPDATE_NEEDED.
> Related: `docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md`, `.claude/skills/completion-audit.md`

---

### 1. reactive-incremental-thinking

**Trigger conditions**:
- User uses holistic-quality phrases ("state of the art", "максимально передовое", "what's missing", "proper architecture")
- AI immediately identifies 3-5 incremental additions without pausing for systems analysis
- AI dispatches chief-architect before running gap analysis against industry patterns

**Prevention rule**: When any trigger phrase fires, STOP. Run `.claude/skills/proactive-holistic-analysis.md` 6-step protocol in full before any dispatch. Aim for 15-25 gap items, not 3-5. Wait for explicit user approval of direction.

**Memory MCP entity**: `anti-pattern-reactive-incremental-thinking`

**Examples from history**:
- wave-95 through wave-103: AI shipped three incremental waves (SDD infra, Quality Agency, Multi-Level Verification) before surfacing the missing 5-level hierarchical spec system. User had to name the pattern explicitly ("основная спека → cascade").

**Escalation path**: If triggered after wave-117 retro, meta-process-auditor emits REGRESSION_DETECTED. Chief-architect dispatch is blocked until human reviews.

---

### 2. partial-closure-via-documentation

**Trigger conditions**:
- Anti-pattern or bug is identified and documented (skill file, trigger doc, retro entry) but no enforcement mechanism ships in the same wave
- Documentation says "this is fixed" or "this prevents recurrence" but the only artifact is a markdown file
- Enforcement is listed as "documentation" in a completion audit rather than "active hook", "hard block", or "external audit"

**Prevention rule**: Documentation is never sufficient closure for a behavioral anti-pattern. Every documented rule must ship at least one of: pre-commit hook, automated script check, agent gating, or memory MCP enforcement. The completion-audit block (`.claude/skills/completion-audit.md`) must enumerate the enforcement type explicitly.

**Memory MCP entity**: `anti-pattern-partial-closure-via-documentation`

**Examples from history**:
- wave-117 retro: proactive-holistic-analysis trigger doc was written. Within the same session, AI shipped 60-70% of the actual enforcement and declared done. The skill existed; enforcement hooks did not. Wave-145 closes the gap.
- wave-150 closes the recursive instance where the auditor itself was convention-only.
  Enforcement artifact: `.husky/post-commit:87-88` — `node scripts/common-launcher.mjs scripts/audit-meta-process.mjs`.
  Closure type: active post-commit hook (not documentation). PFCA K3: satisfied.

**Escalation path**: Completion-audit block must show enforcement type as something other than "documentation" for any closure claim about a behavioral rule. If enforcement type remains "documentation", the completion audit closure level must be < 100% with explicit deferred items.

---

### 3. optimistic-completion-bias

**Trigger conditions**:
- AI message contains "done", "shipped", "complete", or "closed" without a structured closure audit
- Gaps are present but not enumerated (AI assumes "good enough" rather than explicitly listing what remains)
- Percentage completion is stated informally ("mostly done", "80% there") without itemizing the missing 20%

**Prevention rule**: Before any "done" claim, emit the mandatory completion-audit block (`.claude/skills/completion-audit.md`). The block requires explicit enumeration of all remaining gaps. Closure level is 100% ONLY if all gaps are explicitly addressed — not if gaps are absent from awareness.

**Memory MCP entity**: `anti-pattern-optimistic-completion-bias`

**Examples from history**:
- wave-117: AI declared proactive-holistic-analysis fix "done" after writing documentation. The enforcement mechanism layer (hooks, scripts, agent gating) was not shipped. This is the direct cause of wave-145.

**Escalation path**: If "done" claim is made without a completion-audit block, meta-process-auditor treats the wave as having skipped the closure gate. Next wave dispatch requires human explicit sign-off that the previous wave's gaps are accepted.

---

### 4. asymmetric-closure-standards

**Trigger conditions**:
- Product waves receive full spec/AC/quad-lens/retro treatment
- Meta-process fixes (anti-pattern docs, dev tooling, skill files) receive informal treatment with no ACs, no enforcement hooks, no retro
- "This is just a doc fix" reasoning used to skip process steps

**Prevention rule**: Apply the same closure standards to meta-process work as to product work. Every meta-process fix that claims to prevent recurrence must have: ACs (written before implementation), enforcement mechanism (not just documentation), and a retro entry documenting what was shipped vs deferred.

**Memory MCP entity**: `anti-pattern-asymmetric-closure-standards`

**Examples from history**:
- wave-117 retro fix (proactive-holistic-analysis): treated as "just add a doc file", no ACs written, no enforcement hooks added, no completion audit. The rigorous process applied to product waves was skipped entirely for the meta-process fix.

**Escalation path**: Chief-architect dispatch for meta-process waves must include ACs in the same format as product waves. Spec Reviewer SR-23 checks meta-process specs with the same criteria as product specs.

---

### 5. over-documentation

**Trigger conditions**:
- Documentation layers accumulate (skill files, trigger docs, roster entries, coding standards sections) without any agent being explicitly responsible for reading them
- Rules are "documented but not enforced" — a human or agent would have to voluntarily read and comply
- The same rule appears in 3+ places (skill file, trigger doc, coding standards, retro) with no single source of truth

**Prevention rule**: Every documented rule must have exactly one source of truth and at least one enforcement mechanism that fires without voluntary compliance. Before adding a new documentation layer, ask: "Which agent reads this, and when?" If the answer is "anyone who happens to read it", the rule is soft and will not be followed.

**Memory MCP entity**: `anti-pattern-over-documentation`

**Examples from history**:
- proactive-holistic-analysis rule appears in: `.claude/skills/proactive-holistic-analysis.md`, `docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md`, `docs/CODING_STANDARDS.md`, `docs/AGENT_ROSTER.md` (4 locations). Each location is soft. None fires automatically.

**Escalation path**: When a rule is documented in 3+ locations without enforcement, the next meta-process wave must add an enforcement hook before adding more documentation locations.

---

### 6. scope-creep-mid-wave

**Trigger conditions**:
- Implementation agent (frontend-agent) adds files, features, or behaviors not in the approved master spec
- "While I'm here" reasoning — agent notices a related gap and addresses it without re-submitting to Chief Architect
- Wave commit diff touches file paths not listed in the spec's Component inventory

**Prevention rule**: Every out-of-scope addition requires re-submission to Chief Architect before implementation, even if it is "obviously related" or "small". The scope boundary is the approved master spec's Component inventory. Additions outside that boundary are separate waves.

**Memory MCP entity**: `anti-pattern-scope-creep-mid-wave`

**Examples from history**:
- wave-103 verification pipeline: debate-engine script expanded mid-wave to include a best-of-N selection mechanism that was not in the original spec. Shipped without re-review.

**Escalation path**: If scope creep is detected post-commit (by retro or meta-process-auditor), the out-of-scope artifact must be reviewed in the next wave before it can be cited as a dependency. Spec Reviewer SR-23 checks component inventory vs actual diff before Shipped transition.

---

### 8. cross-line-authority-contamination

**Slug**: `cross-line-authority-contamination`
**First observed**: wave-153

**Description**: A Second Line (Risk-Compliance) agent runs a policy gate that is the exclusive authority of another Second Line agent. The duplicate check is neither independent (same line, overlapping scope) nor additive (running the same questions twice produces no new signal). This creates ambiguity about which agent's verdict is binding when they conflict, and dilutes the authority of the canonical owner.

**Specimen case** (wave-153): Reflexion Critic (L0.95) Gate 3 ran Mission Compass questions Q1-Q5 as part of its adversarial review. Constitutional Reviewer (L0.96) is the canonical owner of Q1-Q5 per `docs/AGENT_ROSTER.md` and `docs/MISSION.md`. Both agents fired in the same pipeline with overlapping authority. If Reflexion Critic emitted CONCERN on Q3 while Constitutional Reviewer emitted PASS, there was no defined tie-break rule.

**Fix applied** (wave-153 T.3): Reflexion Critic Gate 3 was rewritten to spec-compliance only — AC coverage, dropped ACs, partial implementations. Mission Compass Q1-Q5 authority belongs exclusively to Constitutional Reviewer. The Reflexion Critic entry in `docs/AGENT_ROSTER.md` explicitly states "does not re-adjudicate mission alignment — that gate belongs to constitutional-reviewer (L0.96)."

**Prevention rule**: When adding a new policy gate to a Second Line agent, verify that no other agent in the same pipeline already owns the same scope. Second Line agents that run policy checks must not duplicate the exact policy-gate scope of another Second Line agent. If a new gate overlaps with an existing canonical owner, either (a) route through the canonical owner, or (b) add a conflict-resolution rule with explicit binding-verdict designation before shipping.

**Memory MCP entity**: `anti-pattern-cross-line-authority-contamination`

**Escalation path**: meta-process-auditor detects this pattern when two agents in the same L-tier section claim the same verification scope in their roster entries. Emits `CATALOG_UPDATE_NEEDED` if a new agent entry duplicates scope without a cited conflict-resolution rule.

---

### 7. wave-spec-drift

**Trigger conditions**:
- Product code is modified after a wave is marked Shipped without updating the corresponding master spec
- A retro or follow-up commit changes behavior documented in a spec without bumping the spec version
- `docs/specs/wave-NN_MASTER_SPEC.md` frontmatter `status: Shipped` but its described behavior no longer matches the codebase

**Prevention rule**: Any modification to shipped behavior requires either (a) a new wave with a new spec, or (b) an explicit spec amendment with version bump and cascade-validate run. No code changes to shipped functionality without a spec artifact tracking the change.

**Memory MCP entity**: `anti-pattern-wave-spec-drift`

**Examples from history**:
- wave-95 SDD config: `.sdd-config.json` fields were added in wave-117 without a spec amendment. The wave-95 master spec still shows only `hard_block_ac` and `cascade_hard_block` fields. The actual file has more fields not documented anywhere.

**Escalation path**: cascade-validate.mjs detects child spec references to parent spec versions. If a shipped spec's described API (fields, scripts, hook blocks) diverges from actual code, cascade-validate should emit AMBIGUOUS. This is currently a gap in cascade-validate coverage (tracked in wave-145 deferred items).

**Closed by wave-157**: `scripts/detect-drift.mjs` DR1-DR7 enforce this mechanically. Per-commit mode (--staged) checks spec YAML, roster annotations, and .sdd-config keys on every relevant commit. Daily mode (--comprehensive via `.github/workflows/drift-daemon.yml` cron `0 6 * * *`) scans all Shipped specs' file inventories, hash-chain integrity, hierarchy, and anti-pattern slug references. Drift events are written to `docs/audits/drift-events.jsonl` (6th telemetry stream). No auto-remediation — human approval required per Atlantis PR-approval model (T3). Enforcement type: active hook (pre-commit) + scheduled CI. NOT documentation-only per anti-pattern #2.

---

### 9. dispatch-brief-vs-master-spec-drift

**Trigger conditions**:
- Orchestrator (or any human/agent) authors a dispatch brief for an implementation agent (e.g., frontend-agent) that lists more files / broader scope than the chief-architect's master spec captures
- Orchestrator then judges the implementation against the dispatch brief instead of the master spec
- Implementation correctly follows master spec, but Orchestrator declares partial-closure or false REVISE because deliverables don't match the broader brief

**Prevention rule**: Orchestrator MUST read the master spec post-chief-architect-synthesis and verify it matches dispatch intent BEFORE dispatching implementation. If divergence is found, send chief-architect a scope-expansion follow-up to amend the spec (with version bump). The master spec is the contract — dispatch briefs are scaffolding for chief-architect, not for impl agents. Reflexion Critic always judges against master spec.

**Memory MCP entity**: `anti-pattern-dispatch-brief-vs-master-spec-drift`

**Specimen case** (wave-153): Orchestrator's dispatch brief to chief-architect listed ~12 files (scripts/check-cross-line-dispatch.mjs, docs/THREE_LINES_OF_DEFENSE.md, .husky/post-commit edits, docs/CODING_STANDARDS section, .claude/agents/*.md YAML, etc.). Chief-architect synthesized a narrower master spec per Cartographer EXTEND verdict (5 files, documentation-only). this project-front-agent followed master spec exactly. Orchestrator pre-judged impl as 80% partial-closure based on dispatch brief breadth, not master spec ACs. Reflexion Critic verdict was correctly PASS — all 10 master spec ACs satisfied. The deferred items in frontend-agent's completion-audit were per chief-architect's D1 explicit deferral to wave-154, not partial-closure.

**Examples from history**:
- wave-153 (initial detection): Orchestrator anticipated REVISE based on file-count mismatch with dispatch brief. Reflexion Critic correctly identified that frontend-agent followed master spec, and the broader scope was the dispatch brief overreach. Cataloged as new anti-pattern.

**Escalation path**: When Orchestrator drafts dispatch brief for chief-architect, the brief should explicitly state "this brief is input for chief-architect synthesis; chief-architect will produce master spec which becomes the contract for impl." When Orchestrator dispatches impl agent, the dispatch should reference master spec path, NOT re-enumerate scope. meta-process-auditor detects this pattern by comparing dispatch-message file references against the named master spec's component inventory.

**Additional trigger condition** (wave-158 FORCED_RESUME gap): A scenario described in the dispatch brief is not reflected in the spec's AC set. The spec is synthesized from the brief but a specific scenario (e.g., FORCED_RESUME on `--no-verify` bypass) is mentioned in the brief yet has no corresponding binary-testable AC. The gap is detectable before dispatch but no mechanism existed to catch it. Detection question: "Does each scenario in the brief have a corresponding AC in the spec?"

**Prevention rule (PFCA K2)**: PFCA K2 must flag missing AC coverage before dispatch — if any scenario or behavior described in the brief or spec §2 Current State section lacks a binary-testable verification command in the AC set, K2 returns `no` and the checklist emits WARN or BLOCK. This closes the wave-158 class of gap.
