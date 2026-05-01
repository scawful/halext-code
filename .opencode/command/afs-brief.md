---
description: cheap AFS briefing for this workspace
---

Use Python AFS to produce a concise workspace briefing.

Rules:

- Keep this cheap and fast.
- Start with `afs_local_context_status`.
- Use `afs_local_context_query`, `afs_local_context_list`, or
  `afs_local_context_read` only when they add real signal.
- Do not call nondefault task, handoff, memory, diff, freshness, or repair MCP
  tools. Route those to `/afs-tasks`, `/afs-handoff`, `/afs-review-context`,
  `/afs-refresh`, or the AFS CLI if needed.
- Do not call `afs_local_session_pack`.

Summarize:

- overall context health
- any task or handoff follow-up that needs a routed command
- one short recommendation or next step

If `$ARGUMENTS` is present, bias the briefing toward that focus.

$ARGUMENTS
