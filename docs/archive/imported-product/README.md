# Archive — imported product docs

These documents belong to the PRODUCT the framework grew out of (a home-services SMB multi-agent OS), not to the jidoka framework itself. They were carried into this repo during extraction and kept generating broken references (35+ missing-file findings in `spec-drift-check`) because they cite product files (`lib/agents/workflows.ts`, `BACKEND_TZ_YURA_*`, funnel registries) that exist only in the product repo.

Archived 2026-06-05 during the spec-tree overhaul. Kept as worked examples of how a complex agentic system can be specified (L1 frontmatter, version lineage, production-incident analysis) — read-only, excluded from spec scanners, never parents of framework specs.

| File | What it is |
|---|---|
| `AGENT_LAYER_ARCHITECTURE.md` | Product backend agent-layer architecture (funnels, meta-agents) |
| `AGENT_LAYER_QUALITY_SPEC.md` | Product quality/safety spec addressed to the product's backend lead |
| `AGENTIC_ENGINEERING_TZ.md` / `_V2.md` | Product dev-environment TZ referencing product files |
| `KAIZEN_PHILOSOPHY.md` | Product-facing Kaizen positioning (frontline calls, dispatcher routes) |

The framework's own canon lives at `docs/NORTH_STAR.md` (L0), `docs/CONSTITUTION.md` (L0), and the L1 docs listed in Constitution §2–§9.
