// PROPOSED meta-remedies.mjs (2026-07-12) — supersedes the 2026-06-06 proposal (which was never
// applied) and adds two changes on top of it:
//   1. NEW class 'browser-verification-skipped' — its gate (browser-verify-gate.mjs Stop hook) has
//      been live since 2026-07-02 but was never registered, so memory-consolidate kept reporting
//      it as "ungated — live risk".
//   2. 'declaration-over-implementation' — now ALSO enforced by the proof-of-work-gate Stop hook
//      (hooks/proof-of-work-gate.mjs, wired in ~/.claude/settings.json hooks.Stop since 2026-07-12):
//      a session that edited source code but executed nothing after the last edit is blocked once.
//      Previously the mechanism (proof-gate.mjs) was invocable-only — a paper gate.
//
// meta-remedies.mjs is L0 (the gate registry); policy-enforce-hook refuses agent writes to it by
// design, so this proposal is applied under explicit OWNER approval:
//
//     cp docs/proposals/meta-remedies.proposed.mjs scripts/meta-remedies.mjs
//     node scripts/meta-audit.mjs    # new classes read "gated & holding", not "ungated recurring"
//     node scripts/eval-suite.mjs    # expect green

// Single source of truth for the meta-mistake gate registry.
//
// Consumed by every engine in the family:
//   meta-audit      — recurrence / regression / holding classification
//   meta-trend      — learning curve (time-to-gate, coverage, regression rate)
//   meta-premortem  — preventive check of a planned action against known classes
//   meta-generalize — lesson families (which gate covers which adjacent classes)
//   meta-decay      — aging of gates that have held untouched for a long time
//
// Each entry: a mistake class -> the architectural remedy that gates it.
//   since     — the date the gate went live (closes the learning loop: incidents
//               strictly after it are regressions, not the cause of the gate)
//   mechanism — the executable that ENFORCES the gate (null = documented-only,
//               which is weaker and flagged as such by the engines)
//   gate      — the rule the mechanism enforces, in prose
//   family    — adjacent classes the SAME gate logic also covers, so a lesson
//               learned for one class generalizes instead of staying isolated
//   premortem — { risk, clears }: signatures in a PLANNED action. `risk` matches
//               language that historically precedes this class; `clears` matches a
//               proof/awareness token that neutralizes it. risk-without-clears =
//               a preventive warning before the mistake is made (meta-premortem).
//
// An unregistered recurring class is escalated by meta-audit (build a gate).

export const REMEDIES = {
  'declaration-over-implementation': {
    // 2026-06-06 regression (wave-meta-gates: commit said selftest-reality registered, registry got
    // mutation-test; gate built but unwired). Strengthened: gate-audit.mjs now blocks ORPHAN gate:*
    // scripts (no workflow/hook/installer caller) — "wired" is verified mechanically, not claimed.
    // 2026-07-12: enforcement closed — proof-of-work-gate.mjs (Stop hook) now watches what the
    // session DID: source edited + nothing executed after the last edit → the stop is blocked once.
    since: '2026-06-06',
    mechanism: 'hooks/proof-of-work-gate.mjs',
    family: ['claim-without-test', 'fixed-without-rerun', 'wired-without-trace', 'orphaned-gate', 'code-edited-nothing-run'],
    premortem: {
      risk: /\b(done|implemented|fixed|wired|works|working|complete[d]?|ready|finished|mechanical(?:ly)?)\b/i,
      clears: /\b(test|spec|passes|passing|exit code|output shown|proof|verified by running|\.test\.|\.spec\.)\b/i,
      advise: 'ship an executable proof (a passing test, a blocking hook, or shown command output) in the same turn',
    },
    gate:
      'A claim of "implemented / wired / mechanical / fixed / done" MUST ship an EXECUTABLE proof in the same turn: ' +
      'a test that passes, a hook that blocks, or a command whose output is shown. No proof artifact in the turn → ' +
      'status is NOT done. Enforced two ways: proof-of-work-gate.mjs (Stop hook, wired in ~/.claude/settings.json ' +
      'hooks.Stop since 2026-07-12) blocks a session stop once when code was edited but nothing was executed after ' +
      'the last edit; proof-gate.mjs remains the invocable typed-proof runner (a UI claim needs a browser proof, ' +
      'a data-removal claim needs a history scan).',
  },
  'browser-verification-skipped': {
    // Owner escalation 2026-07-02 ("в каждой сессии ты не делаешь проверку в браузере и
    // пропускаешь!"): tsc+tests green was treated as "UI change done" session after session.
    // The gate went live the same day but was never registered here, so memory-consolidate
    // kept reporting the class as ungated. This entry closes the registry, not the gate.
    since: '2026-07-02',
    mechanism: 'hooks/browser-verify-gate.mjs',
    family: ['ui-done-without-look', 'tsc-green-as-ui-proof', 'screenshot-skipped'],
    premortem: {
      risk: /\b(ui|css|layout|render(s|ed|ing)?|component|screen|visual|tsx|jsx)\b|экран|вёрстк|компонент|стил/i,
      clears: /\b(screenshot|playwright|browser|preview_|headed|claude-in-chrome|computer-use)\b|скрин|браузер/i,
      advise: 'open a real browser, navigate to the affected screen, screenshot it and LOOK before saying done — tsc/tests prove logic, only the browser proves it looks and behaves right',
    },
    gate:
      'Editing observable UI is complete ONLY after a real browser look (navigate + screenshot + read the ' +
      'screenshot). Enforced by browser-verify-gate.mjs (Stop hook, wired in ~/.claude/settings.json hooks.Stop ' +
      'since 2026-07-02): a session that edited UI source but never called a browser tool is blocked once. ' +
      '"No data / server down" is not an excuse — render the state on a throwaway route and screenshot that. ' +
      'Rule text: ~/.claude/rules/browser-verification-mandatory.md + docs/BROWSER_VERIFICATION_MANDATORY.md.',
  },
  'tree-not-history': {
    since: '2026-05-29',
    mechanism: 'scripts/pre-publish-guard.mjs',
    family: ['secret-in-history', 'cleanup-current-state-only'],
    premortem: {
      risk: /\b(publish|public repo|cleanup|cleaned|remove[d]? (the )?secret|sanitiz|ready to ship|open[- ]?source)\b/i,
      clears: /\b(git log|history|log -p|pre-publish-guard|scanned history|full history)\b/i,
      advise: 'scan the full git history (scripts/pre-publish-guard.mjs), not just the working tree',
    },
    gate: 'Cleanup/security claims must scan full history, not current state. Mechanism scans git log -p.',
  },
  'reward-hacking': {
    since: '2026-05-31',
    mechanism: 'scripts/meta-honesty.mjs',
    family: ['synonym-pile', 'booster-words', 'self-confirming-retro', 'eval-gaming'],
    premortem: {
      risk: /\b(flawless|perfect(ly)?|bulletproof|comprehensive|robust|seamless|world[- ]class|state[- ]of[- ]the[- ]art|100%|all \w+ (pass(ed|ing)?|verified|confirmed|successful))\b/i,
      clears: /\b(external|red[- ]?team|falsif|counterexample|caught_by|independent (check|review|judge)|adversarial)\b/i,
      advise: 'get an EXTERNAL/adversarial check that could falsify the claim; more pass-synonyms is lexical novelty, not semantic evidence',
    },
    gate:
      'A retro/claim must not GAME the reward signal. Done/pass-synonym restatements, booster-word piles, ' +
      'and self-confirming entries are caught by meta-honesty (synonym-pile + booster detection + external-catch ' +
      'ratio); red-team continuously attacks this class. Lexical novelty is not semantic novelty.',
  },
  'self-test-blindspot': {
    since: '2026-06-02',
    mechanism: 'scripts/selftest-reality.mjs',
    family: ['threshold-untested', 'boundary-case-missed', 'near-target-untested', 'happy-path-only'],
    premortem: {
      risk: /\b(self-test|unit test|self-tested|passes|green|tested|covered|all cases)\b/i,
      clears: /\b(boundary|near-target|edge case|property|forAll|mutation|random input|min\b|max\b|threshold)\b/i,
      advise: 'test BOUNDARY/near-target cases, not just convenient ones; back the self-test with mutation-test (kills un-asserted code) + property-test (random inputs surface threshold bugs)',
    },
    gate:
      'A self-test must actually run and assert (selftest-reality.mjs blocks exit-0-with-no-assertion-output, ' +
      'the "never ran" fingerprint) AND cover boundary/near-target cases, not only convenient ones. Back it with ' +
      'mutation-test (scripts/mutation-test.mjs, kills code no assertion catches) and property-test ' +
      '(scripts/property-test.mjs, random inputs find the threshold bug). Real data surfacing a self-test gap = this class.',
  },
  'scope-narrowed-silently': {
    since: '2026-05-29',
    mechanism: null,
    family: ['top-n-unstated', 'sampled-as-full', 'partial-as-complete'],
    premortem: {
      risk: /\b(top \d+|first \d+|a few|sampled?|main ones|key (files|ones|parts)|most important|partial)\b/i,
      clears: /\b(only|limited to|boundary|not exhaustive|\d+ of \d+|out of \d+|explicitly|i'm stating)\b/i,
      advise: 'state the boundary explicitly in the same turn (e.g. "top 10 of 240"), so it does not read as full coverage',
    },
    gate: 'If a task is bounded (top-N, sampled, partial), the boundary must be stated explicitly in the same turn. Silent truncation reads as full coverage.',
  },
};
