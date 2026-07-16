---
description: inspect or preview friendly AFS setup for this workspace
---

Inspect or preview AFS setup for this workspace.

Rules:

- Run the router:

  `"${AFS_CLI:-afs}" next --path . --intent setup --json`

- Prefer manager snapshot or setup dry-run before writing anything:

  `"${AFS_CLI:-afs}" manager snapshot --path . --json`

  `"${AFS_CLI:-afs}" setup --workspace . --dry-run`

- Do not mutate `.gemini`, `.claude`, `.opencode`, `.mcp.json`, shell startup,
  or extension config unless the user approves the preview.

Return: current setup state, recommended setup action, and exact apply command
if approval is needed.

$ARGUMENTS
