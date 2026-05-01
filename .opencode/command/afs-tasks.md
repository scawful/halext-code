---
description: show current AFS tasks for this workspace
---

Use Python AFS or the AFS CLI to inspect the current task queue for this
workspace.

Rules:

- Prefer `~/src/lab/afs/scripts/afs tasks list --path . --json` because
  `task.*` is not part of the default slim MCP catalog.
- Use MCP task tools only in an explicit full-catalog/debug session.
- Keep the answer focused on actionable tasks, blockers, and next steps.
- Do not call session pack in this command.

Summarize:

- active and pending tasks
- ownership if available
- blockers or missing handoff context
- the most sensible next action

$ARGUMENTS
