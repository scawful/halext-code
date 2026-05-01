---
description: create a fresh AFS handoff packet for this workspace
---

Create a new handoff packet for this workspace using Python AFS.

Rules:

- Use cheap AFS reads first only when they materially improve the handoff:
  `afs_local_context_status`, `afs_local_context_query`, `afs_local_context_list`,
  and `afs_local_context_read`.
- Then write one concise markdown handoff under `scratchpad/handoffs/` with
  `afs_local_context_write`.
- Use MCP `handoff.create` only in an explicit full-catalog/debug session.
- Fold `$ARGUMENTS` into the handoff as operator note, emphasis, or extra next
  step when helpful.
- Do not call session pack in this command.

Summarize:

- the created handoff path
- the main accomplished items
- the main blockers if any
- the stored next steps

$ARGUMENTS
