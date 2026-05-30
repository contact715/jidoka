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
//
// An unregistered recurring class is escalated by meta-audit (build a gate).

export const REMEDIES = {
  'declaration-over-implementation': {
    since: '2026-05-29',
    mechanism: 'scripts/proof-gate.mjs',
    family: ['claim-without-test', 'fixed-without-rerun', 'wired-without-trace'],
    gate:
      'A claim of "implemented / wired / mechanical / fixed / done" MUST ship an EXECUTABLE proof in the same turn: ' +
      'a test that passes, a hook that blocks, or a command whose output is shown. No proof artifact in the turn → ' +
      'status is NOT done. Enforce as a done-gate; do not rely on the agent recalling verification-before-completion.',
  },
  'tree-not-history': {
    since: '2026-05-29',
    mechanism: 'scripts/pre-publish-guard.mjs',
    family: ['secret-in-history', 'cleanup-current-state-only'],
    gate: 'Cleanup/security claims must scan full history, not current state. Mechanism scans git log -p.',
  },
  'scope-narrowed-silently': {
    since: '2026-05-29',
    mechanism: null,
    family: ['top-n-unstated', 'sampled-as-full', 'partial-as-complete'],
    gate: 'If a task is bounded (top-N, sampled, partial), the boundary must be stated explicitly in the same turn. Silent truncation reads as full coverage.',
  },
};
