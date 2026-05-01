---
description: prepare changes to ship with scope review and verification
---

Prepare the current changes to ship.

Rules:

- Run the router:

  `~/src/lab/afs/scripts/afs next --path . --intent ship --json`

- Confirm scope with `git status --short` and inspect relevant diffs.
- Run `git diff --check` and the smallest relevant verification from
  `~/src/lab/afs/scripts/afs verify plan --cwd . --json`.
- Commit/push only when the user explicitly asked to commit/push or the current
  instruction clearly includes shipping. Never force-push or rewrite history
  without explicit approval.
- Keep unrelated/untracked private config out of commits.

Return: scope, verification, commit/push status or commit-ready next step.

$ARGUMENTS
