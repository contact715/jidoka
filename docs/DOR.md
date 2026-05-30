# Definition of Ready (DOR)

> Formal anchor for wave-level dispatch gates. Operational implementation: `scripts/run-checklist.mjs --phase dor`.
> Each item below corresponds to a killer question in `docs/checklists/phase-dor.md`.
> PFCA reads and evaluates these items before any chief-architect dispatch, implementation dispatch, or done-claim.

---

## Universal Killer Items (K1-K5)

The following 5 items must each return `yes` or `n/a` before a wave is dispatched. Any `no` answer
triggers a WARN (soft mode) or BLOCK (hard mode) per `pfca.hardBlockEnabled` in `.sdd-config.json`.

1. **K1 — Spec file exists with status: Draft.** Does `docs/specs/wave-NN_MASTER_SPEC.md` exist with a `status: Draft` field (not just a brief or ticket)?
   Guards against: anti-pattern #7 `wave-spec-drift`, anti-pattern #4 `asymmetric-closure-standards`.

2. **K2 — Binary-testable verification commands.** Does each AC in the spec include a binary-testable verification command (grep, tsc, e2e) that emits a clear PASS or FAIL signal?
   Guards against: anti-pattern #3 `optimistic-completion-bias`.

3. **K3 — At least one enforcement mechanism ships.** Does this wave ship at least one enforcement mechanism (hook, script, agent) and not documentation alone?
   Guards against: anti-pattern #2 `partial-closure-via-documentation`.

4. **K4 — Scope IN / Scope OUT both enumerated.** Does §7 of the spec enumerate both an explicit Scope IN list and an explicit Scope OUT list?
   Guards against: anti-pattern #6 `scope-creep-mid-wave`, anti-pattern #9 `dispatch-brief-vs-master-spec-drift`.

5. **K5 — No unattributed authority overlap.** Does any gate in this wave overlap the decision authority of an existing agent in `docs/AGENT_ROSTER.md`? The answer must be NO or must carry an explicit attributed override.
   Guards against: anti-pattern #8 `cross-line-authority-contamination`.

---

## Per-tier additions

Additional items are appended after K1-K5 when `--tier` is passed to `run-checklist.mjs`. Maximum 8 total items per Miller's Law.

See `docs/checklists/phase-dor.md` for the full per-tier checklist including L0-L4 additions.

---

## References

- Checklist runner: `scripts/run-checklist.mjs --phase dor --wave wave-NNN`
- Checklist definitions: `docs/checklists/phase-dor.md`
- PFCA agent spec: `.claude/agents/pfca-agent.md` (mirrored at `docs/skills/pfca-checklist.md`)
- Anti-pattern catalog: `docs/ANTI_PATTERNS_CATALOG.md`
- Config: `.sdd-config.json` key `pfca`

---

Wave-159 introduced this document. Previously, DOR was referenced (e.g., `docs/retros/wave-53.md:26`) but no formal document existed.
