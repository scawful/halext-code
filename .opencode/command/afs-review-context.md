---
description: review AFS context health, drift, and missing state for this workspace
---

Review whether AFS context is healthy and sufficient for the current work.

Rules:

- Start with `afs_local_context_status`.
- Use `afs_local_context_diff` and `afs_local_context_freshness` when they add
  real signal.
- Use `afs_local_task_list`, `afs_local_handoff_list`, or
  `afs_local_handoff_read` only if they clarify missing task or continuity
  state.
- If `$ARGUMENTS` names a topic, bug, or area, use `afs_local_context_query`
  for that focus.
- Do not call `afs_local_session_pack`.

Summarize:

- whether the context is healthy enough for normal work
- any freshness or drift caveat
- any missing scratchpad, task, or handoff context that should be fixed
- the lightest useful next action

$ARGUMENTS
