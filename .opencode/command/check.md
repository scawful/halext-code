---
description: choose and run the smallest useful verification
---

Verify the current change or question with the narrowest trustworthy check.

Rules:

- Run the router:

  `~/src/lab/afs/scripts/afs next --path . --intent verify --json`

- Prefer the returned verification plan command before guessing tests.
- Run one check at a time.
- If a check fails, report the failing surface and the smallest next diagnostic.
- If no check can run, report the exact blocker and residual risk.

Return: check command, result, and whether the work is safe to call done.

$ARGUMENTS
