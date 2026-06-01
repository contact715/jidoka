---
description: Run the deterministic eval suite and report pass-rate vs baseline
allowed-tools: Read, Bash
---
Run `node scripts/eval-suite.mjs` (or `.jidoka/scripts/eval-suite.mjs` in an installed project) and
report the pass-rate, any regression vs baseline, and which cases (if any) fail. Do not update the
baseline unless explicitly asked. If a case fails, name it and stop — do not auto-fix.
