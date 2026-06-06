# Skill: Wire before claim — a built mechanism is not protection until something CALLS it

> Wave: wave-meta-gates  |  Status: experimental  |  Scope: global  |  Tags: [meta, process, gating, wiring, verification, anti-tunnel-vision]

<!-- Status values: experimental (1-4 wave applications) | stable (5+ wave applications) | deprecated (zero citations in last 5 waves) -->

---

## When to use

Fire this skill whenever you are about to claim a gate, hook, script, test command, or any enforcement mechanism is "live", "wired", "runnable", or "enforcing". The mechanism passing its own self-test is NOT enough — verify a real caller exists.

- You built a `gate:*` / hook / script and are about to call it done or commit it as "live".
- You are about to count `npm test` / `npm run e2e` as proof — confirm tests are actually collected and specs actually exist.
- A registry / index entry claims a mechanism is enforced — confirm the registry points at the mechanism you actually built, not a sibling.
- Any verification phase where "we have an X gate" must mean "X runs on a real trigger", not "X exists in the repo".

---

## Why this exists — three instances in one wave

`wave-meta-gates` shipped the same failure fingerprint three times. The fingerprint: **declaration reads as enforcement.** A thing exists and self-tests green, so it is assumed to protect — but nothing calls it.

1. **Orphan gate.** `gate:selftest` was built, tested 7/7, and committed as "live + runnable" — then lived 3 days with zero callers. No CI workflow, no git hook invoked it. Worse, the L0 registry pointed at a *different* script (`mutation-test`) than the commit message claimed. The gate enforced nothing.
2. **Broken test command.** `npm test` had been red since the initial commit: vitest `setupFiles` pointed at `./tests/setup.ts` which never existed, so 0 tests were collected. The script existed and "passed" by collecting nothing.
3. **Ghost e2e.** `npm run e2e` ran a playwright config for an app that does not exist in this repo. The script was real; the thing it tested was not.

All three: the artifact exists, so it is trusted — but the artifact is not connected to anything live. This is the same root as global CLAUDE.md rule 12 ("will what you add be WIRED to something live, or will it sit dead?"), proven three more times.

---

## Implementation guide

### Step 1 — Standing-caller check (the mechanism must be invoked somewhere live)

Before claiming a `gate:*` / hook / script is enforcing, confirm a STANDING caller invokes it: a CI workflow, a git hook, or an installer that distributes the file to a target repo. A script that nothing calls reads as protection while enforcing nothing.

```js
// A gate is an ORPHAN if neither its package.json script NAME nor its
// underlying file appears in any workflow / git-hook / installer text.
const orphan = !callersText.includes(scriptName) && !callersText.includes(fileBasename);
// Wired = NAME invoked in a workflow/hook, OR FILE shipped by the installer.
```

The repo's `gate-audit` does exactly this across `.github/workflows`, `.githooks`, and `scripts/install-into.mjs` — see Example references.

### Step 2 — Registry-reference check (the registry must point at what you built)

Open the registry / index that claims the mechanism is enforced. Read the entry's target by hand. Confirm it names the script you actually built — not a sibling with a similar name. The wave's incident: the registry mechanism was `mutation-test`, but the commit claimed `selftest-reality`. A registry that points elsewhere is a silent gap.

### Step 3 — Existence-before-counting (a runner is not proof its targets exist)

Do not count a test/e2e command as runtime proof unless its targets actually exist. An `e2e` script alone is not proof of e2e tests — require the `e2e/` specs directory to be present first.

```js
// execution-gate: only count e2e when BOTH the script AND the specs exist
if (pkg.scripts.e2e && files.includes('e2e')) cmds.push({ kind: 'e2e', ... });
// ghost example caught: a package.json shipping "e2e": "playwright test" with no e2e/ dir
```

Same for `npm test`: confirm tests are *collected* (non-zero count), not just that the command exits 0.

### Step 4 — Counterfactual the new check against the real incident

When you add a guard against this (an orphan-gate check, an existence check), feed it the ACTUAL incident as a self-test case and confirm it goes red. A guard that passes its own happy-path self-test but would not have caught the real miss is itself an orphan.

---

## Example references

Real working code in this repo. Verified before citing.

| What | File | Lines |
|------|------|-------|
| Orphan-gate detector + incident note | `scripts/gate-audit.mjs` | L82–L97 |
| Orphan check wired to workflow + git-hook + installer callers | `scripts/gate-audit.mjs` | L155–L166 |
| Counterfactual self-tests (orphan caught; name/installer-wired NOT orphan) | `scripts/gate-audit.mjs` | L120–L123 |
| e2e counts only when `e2e/` specs exist | `scripts/execution-gate.mjs` | L32–L34 |
| Ghost-e2e self-test (script with no specs is skipped) | `scripts/execution-gate.mjs` | L55–L56 |

---

## Anti-patterns / gotchas

- **Self-test green = protected.** The mechanism passing `--self-test` proves it works in isolation, not that anything triggers it. Always check the caller separately.
- **Commit message as proof of wiring.** "live + runnable" in a commit message is a claim, not a trigger. Verify against the repo's reality (workflow/hook/installer), never against the claim.
- **Registry name-similarity blindness.** A registry entry that names a sibling script (`mutation-test` vs `selftest-reality`) looks correct at a glance. Read the exact target.
- **Counting a runner as proof of its targets.** `npm test` exit 0 with 0 tests collected, or `npm run e2e` against a non-existent app, both "pass" while proving nothing. Require collection / spec existence first.
- **Adding a guard that wouldn't catch the incident.** A new check that only self-tests its happy path is itself an orphan. Counterfactual it against the real miss.

---

## Wave history

First applied in wave-meta-gates.

---

## Variations

<!-- Skill Extractor appends here when a new wave applies this skill with a twist. -->
<!-- Format: wave-NN — [brief description of the variation] -->
