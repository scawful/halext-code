---
description: create a fresh AFS handoff packet for this workspace
---

Create a new handoff packet for this workspace using Python AFS.

Rules:

- Use cheap AFS reads first only when they materially improve the handoff:
  `afs_local_task_list`, `afs_local_handoff_list`, and
  `afs_local_context_status`.
- Then call `afs_local_handoff_create` exactly once.
- Fold `$ARGUMENTS` into the handoff as operator note, emphasis, or extra next
  step when helpful.
- Do not call `afs_local_session_pack` in this command.

Summarize:

- the created `session_id`
- the main accomplished items
- the main blockers if any
- the stored next steps

$ARGUMENTS
