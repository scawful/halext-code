---
description: create or inspect a concise AFS continuity handoff
---

Handle continuity handoff state.

Rules:

- Run the router:

  `~/src/lab/afs/scripts/afs next --path . --intent handoff --json`

- For inspection, list/query handoffs and read exact files only.
- For a new handoff, write a concise operational note under
  `.context/scratchpad/handoffs/` or use `/afs-handoff-create` when a formal
  packet is needed.
- Do not run session pack unless the user explicitly asks for a heavy export.

Return: handoff path or relevant existing handoff, current state, verification,
blockers, and next narrow step.

$ARGUMENTS
