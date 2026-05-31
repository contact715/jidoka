---
status: Shipped
type: spec
level: L1
owner: chaos-fixture
---

# Chaos-injection fixture spec (NOT a real spec)

This file exists only for `chaos-inject.mjs` scenario I-2. Its frontmatter is `status: Shipped` but
deliberately OMITS the required `version` field, so `detect-drift.mjs --comprehensive --dry-run`
fires a DR1 (missing-required-frontmatter) block event. Injected as `docs/specs/__chaos_test_spec__.md`
and removed in cleanup.
