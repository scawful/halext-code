---
description: show current AFS tasks for this workspace
---

Use Python AFS to inspect the current task queue for this workspace.

Rules:

- Start with `afs_local_task_list`.
- Keep the answer focused on actionable tasks, blockers, and next steps.
- Do not call `afs_local_session_pack` in this command.

Summarize:

- active and pending tasks
- ownership if available
- blockers or missing handoff context
- the most sensible next action

$ARGUMENTS
