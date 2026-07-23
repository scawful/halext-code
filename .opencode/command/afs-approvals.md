---
description: inspect global agent approvals and prepare human terminal commands
---

Inspect machine-global AFS agent approval requests. This command is read-only
inside hcode.

Request: `$ARGUMENTS`

Rules:

- Default action is read-only listing:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals list --json`

- Session grounding may already mention pending approvals; use this command to
  see the full request detail before acting.
- When the user explicitly directs approval or rejection for an exact
  `(agent, action)` pair, prepare the command for the human to run in their
  controlling terminal. Do not execute the guarded write from the agent:

  First inspect the installed CLI contract:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals approve --help`
  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals reject --help`

  Require `--because`. Ask the human for the exact rationale and place it
  before the positional pair:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals approve --because "<human rationale>" -- <agent> <action>`
  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals reject --because "<human rationale>" -- <agent> <action>`

  If the installed CLI does not expose `--because`, stop and report that AFS
  must be updated. Never downgrade the gate, and never invent, infer, or
  paraphrase a human rationale.

  Return the fully expanded, safely quoted terminal command and say plainly:
  `Run this in your terminal to confirm the guarded decision.` The hcode agent
  must never run `approvals approve` or `approvals reject`; AFS requires the
  human's controlling terminal and typed confirmation.

- Never approve a request as a side effect of another task, and never approve
  your own agent's outward-facing action; that defeats the gate.
- This command manages the global agent guardrail store. Workspace-scoped
  external-write approvals use `afs work approvals ... --path .` and approval
  IDs instead; do not mix the two stores or identifier formats.
- For past decisions use
  `"${AFS_BIN:-${AFS_CLI:-afs}}" approvals history --json`.
- Do not assume an `approvals.*` MCP tool exists; this flow is CLI-only.

Return: pending global agent requests (agent, action, detail), the exact human
terminal command when requested, and what remains blocked. Never claim that an
approval was resolved unless a later read-only listing/history check proves it.
