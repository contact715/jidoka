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
    since: '2026-05-29',
    mechanism: 'scripts/proof-gate.mjs',
    family: ['claim-without-test', 'fixed-without-rerun', 'wired-without-trace'],
    premortem: {
      risk: /\b(done|implemented|fixed|wired|works|working|complete[d]?|ready|finished|mechanical(?:ly)?)\b/i,
      clears: /\b(test|spec|passes|passing|exit code|output shown|proof|verified by running|\.test\.|\.spec\.)\b/i,
      advise: 'ship an executable proof (a passing test, a blocking hook, or shown command output) in the same turn',
    },
    gate:
      'A claim of "implemented / wired / mechanical / fixed / done" MUST ship an EXECUTABLE proof in the same turn: ' +
      'a test that passes, a hook that blocks, or a command whose output is shown. No proof artifact in the turn → ' +
      'status is NOT done. Enforce as a done-gate; do not rely on the agent recalling verification-before-completion.',
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
