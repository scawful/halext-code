---
description: compatibility router for older AFS command sets
---

Route the current request only when the installed AFS lacks a suitable plain
command.

Intent hint: `$ARGUMENTS`

Rules:

- Prefer `afs start/search/files/notes/handoff/messages/projects/jobs/missions/check/repair`
  when the matching command exists.
- If `$ARGUMENTS` is empty, use `continue`.
- Otherwise run:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" next --path . --intent "$ARGUMENTS" --json`
- Follow one returned first step and stop when its stop condition is satisfied.
- Do not use this router to bypass project scope or approval boundaries.

Return the selected route, what ran, and the next concrete action.
