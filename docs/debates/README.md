# Debates — adversarial verification transcripts

This directory holds the transcripts of adversarial debates (`debate-prosecutor` vs
`debate-defender`, ruled by `debate-judge`) and best-of-N rationales, opened and structured by
`scripts/debate-engine.mjs`. Before it existed, agents referenced `docs/debates/` but the directory
did not — a declared-but-empty artifact. Now the engine creates it and writes here.

Each transcript follows the 3-round structure: opening → cross-examination → closing + judge verdict.
`debate-engine` validates a debate actually happened (both adversaries spoke, the judge ruled) and
applies a safety override (an unrefuted blocker can never be waved through as PASS).
