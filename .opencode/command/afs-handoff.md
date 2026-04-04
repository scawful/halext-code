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

- Start with `afs_local_handoff_list`.
- Use `afs_local_handoff_read` only when a specific handoff should be opened.
- If the user clearly wants a new handoff packet instead of inspection, point
  them to `/afs-handoff-create`.
- Do not call `afs_local_session_pack` in this command unless the user
  explicitly asks for a new handoff or export pack.
