---
description: list, inspect, or update durable AFS missions across sessions
---

Work with durable AFS missions for this workspace.

Request: `$ARGUMENTS`

Rules:

- Missions are durable multi-session goals; use them instead of re-deriving
  long-running intent from old handoffs each session.
- Default action is a cheap active listing:

  `"${AFS_CLI:-afs}" mission list --path . --status active --limit 10 --json`

- For one mission's full state:

  `"${AFS_CLI:-afs}" mission show --path . <mission-id>`

- Create a mission only for work that outlives this session and has a clear
  owner and next step. Ask for the owner if the request did not name one, then
  include it explicitly:

  `"${AFS_CLI:-afs}" mission create --path . --title "..." --summary "..." --owner "<owner>" --next-step "..." --json`

- Before creation, inspect
  `"${AFS_CLI:-afs}" mission create --help`. If the installed CLI
  supports `--acceptance`, ask the human for their exact definition of done
  when it was not already supplied, then pass it as `--acceptance "..."`.
  Acceptance is human-authored: never invent, infer, or rewrite it.

- Update status or next steps when a session materially advances or blocks a
  mission (`status`: active, blocked, done, abandoned):

  `"${AFS_CLI:-afs}" mission update --path . <mission-id> ... --json`

- Do not create a mission for one-shot tasks; `/afs-tasks` covers those.
- Do not assume a `mission.*` MCP tool exists; this flow is CLI-only.

Return: active missions with status and next step, plus any mission you
created or updated and why.
