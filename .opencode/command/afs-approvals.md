---
description: inspect and resolve pending AFS approval requests
---

Inspect pending AFS approval requests for this workspace.

Request: `$ARGUMENTS`

Rules:

- Default action is read-only listing:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals list --json`

- Session grounding may already mention pending approvals; use this command to
  see the full request detail before acting.
- Approve or reject ONLY when the user explicitly directs it for the exact
  `(agent, action)` pair shown by the listing:

  First inspect the installed CLI contract:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals approve --help`
  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals reject --help`

  Require `--because`. Ask the human for the exact rationale and pass it before
  the positional pair:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals approve --because "<human rationale>" -- <agent> <action>`
  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals reject --because "<human rationale>" -- <agent> <action>`

  If the installed CLI does not expose `--because`, stop and report that AFS
  must be updated. Never downgrade the gate, and never invent, infer, or
  paraphrase a human rationale.

- Never approve a request as a side effect of another task, and never approve
  your own agent's outward-facing action; that defeats the gate.
- This command manages the global agent guardrail store. Workspace-scoped
  external-write approvals use `afs work approvals ... --path .` and approval
  IDs instead; do not mix the two stores or identifier formats.
- For past decisions use
  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals history --json`.
- Do not assume an `approvals.*` MCP tool exists; this flow is CLI-only.

Return: pending requests (agent, action, detail), what — if anything — was
resolved on explicit user instruction, and what remains blocked.
