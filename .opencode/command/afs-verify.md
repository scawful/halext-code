---
description: choose and run the fastest relevant verification
---

Verify the current change or request:

`$ARGUMENTS`

Rules:

- Prefer the narrowest relevant check for touched files.
- If SessionStart grounding provides `cli_hints.verify_plan`, run its exact
  arguments before falling back to repo-native tests. Replace only its leading
  `afs` token with `${AFS_BIN:-${AFS_CLI:-afs}}` so hcode keeps the configured
  launcher.
- If no current payload hint exists, prepare a lightweight scoped payload with
  `"${AFS_BIN:-${AFS_CLI:-afs}}" session prepare-client --client hcode --cwd . --no-session-pack --json`,
  then run the returned arguments through the same configured launcher.
- Never guess a payload path from the context storage layout.
- Run one verification command at a time.
- If a check cannot run, report the exact blocker and residual risk.
