---
description: cheap AFS briefing for this workspace
---

Use Python AFS to produce a concise workspace briefing.

Rules:

- Keep this cheap and fast.
- Start with `afs_local_context_status`.
- Use `afs_local_task_list`, `afs_local_handoff_list`, or
  `afs_local_memory_status` when they add real signal.
- Use `afs_local_context_freshness` only when the status output suggests search
  freshness may matter.
- Do not call `afs_local_session_pack`.

Summarize:

- overall context health
- pending tasks if any
- recent handoff state if relevant
- one short recommendation or next step

If `$ARGUMENTS` is present, bias the briefing toward that focus.

$ARGUMENTS
