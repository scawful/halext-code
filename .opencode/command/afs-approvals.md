---
description: inspect and resolve pending AFS approval requests
---

Inspect pending AFS approval requests for this workspace.

Request: `$ARGUMENTS`

Rules:

- Default action is read-only listing:

  `~/src/lab/afs/scripts/afs approvals list --json`

- Session grounding may already mention pending approvals; use this command to
  see the full request detail before acting.
- Approve or reject ONLY when the user explicitly directs it for a specific
  request:

  `~/src/lab/afs/scripts/afs approvals approve <request-id>`
  `~/src/lab/afs/scripts/afs approvals reject <request-id>`

- Never approve a request as a side effect of another task, and never approve
  your own agent's outward-facing action; that defeats the gate.
- For past decisions use
  `~/src/lab/afs/scripts/afs approvals history --json`.
- Do not assume an `approvals.*` MCP tool exists; this flow is CLI-only.

Return: pending requests (agent, action, detail), what — if anything — was
resolved on explicit user instruction, and what remains blocked.
