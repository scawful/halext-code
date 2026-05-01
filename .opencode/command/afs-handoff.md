---
description: inspect recent AFS handoffs for this workspace
---

Use Python AFS to inspect handoff state for this workspace.

If `$ARGUMENTS` is empty:

- list recent handoffs and summarize the most relevant recent one

If `$ARGUMENTS` is present:

- use it to identify the most relevant handoff
- then read that handoff if needed

Rules:

- Start with `afs_local_context_list` on `scratchpad/handoffs`.
- Use `afs_local_context_read` only when a specific handoff should be opened.
- Use MCP `handoff.*` only in an explicit full-catalog/debug session.
- If the user clearly wants a new handoff packet instead of inspection, point
  them to `/afs-handoff-create`.
- Do not call session pack in this command unless the user explicitly asks for a
  new handoff or export pack.
