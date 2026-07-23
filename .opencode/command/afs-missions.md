---
description: inspect durable AFS missions and prepare human terminal writes
---

Inspect durable AFS missions for this workspace. This command is read-only
inside hcode.

Request: `$ARGUMENTS`

Rules:

- Missions are durable multi-session goals; use them instead of re-deriving
  long-running intent from old handoffs each session.
- Default action is a cheap active listing:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" missions list --path . --status active --limit 10 --json`

- For one mission's full state:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" missions show --path . <mission-id>`

- When the human wants to create a mission for work that outlives this session,
  gather a clear owner and next step, then prepare this command for the human
  to run in their controlling terminal. Do not execute it from the agent:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" missions create --path . --title "..." --summary "..." --owner "<owner>" --next-step "..." --json`

- Before creation, inspect
  `"${AFS_BIN:-${AFS_CLI:-afs}}" missions create --help`. If the installed CLI
  supports `--acceptance`, ask the human for their exact definition of done
  when it was not already supplied, then pass it as `--acceptance "..."`.
  Acceptance is human-authored: never invent, infer, or rewrite it.

- For a requested status or next-step update (`status`: active, blocked, done,
  abandoned), prepare the exact command for the human terminal. Do not execute
  it from the agent:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" missions update --path . <mission-id> ... --json`

- Return fully expanded, safely quoted create/update commands and say plainly:
  `Run this in your terminal to confirm the mission write.` AFS may require the
  human's controlling terminal, especially for acceptance-bearing writes.
  Never claim the write succeeded until a later read-only `missions show` or
  `missions list` proves it.

- Do not create a mission for one-shot tasks; `afs jobs` covers those.
- Do not assume a `missions.*` MCP tool exists; this flow is CLI-only.

Return: active missions with status and next step, plus any exact human
terminal command requested for a create or update.
