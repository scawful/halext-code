---
description: review AFS context health, drift, and missing state for this workspace
---

Review whether AFS context is healthy and sufficient for the current work.

Rules:

- Start with `afs_local_context_status`.
- Use `afs_local_context_query`, `afs_local_context_list`, or
  `afs_local_context_read` when they add real signal.
- If drift or freshness is the actual question, use the AFS CLI/framework path
  (`afs context repair --dry-run --json` or `/afs-refresh`) instead of assuming
  `context.diff` is in the default MCP catalog.
- Use task, handoff, memory, or work CLI/slash-command flows only if they
  clarify missing continuity state.
- Do not call full-catalog MCP tools unless the session was explicitly launched
  for full-catalog/debug work.
- If `$ARGUMENTS` names a topic, bug, or area, use `afs_local_context_query`
  for that focus.
- Do not call `afs_local_session_pack`.

Summarize:

- whether the context is healthy enough for normal work
- any freshness or drift caveat
- any missing scratchpad, task, or handoff context that should be fixed
- the lightest useful next action

$ARGUMENTS
