---
description: inspect or preview friendly AFS setup for this workspace
---

Inspect or preview AFS setup for this workspace.

Rules:

- Run the router:

  `~/src/lab/afs/scripts/afs next --path . --intent setup --json`

- Prefer manager snapshot or setup dry-run before writing anything:

  `~/src/lab/afs/scripts/afs manager snapshot --path . --json`

  `~/src/lab/afs/scripts/afs setup --workspace . --dry-run`

- Do not mutate `.gemini`, `.claude`, `.opencode`, `.mcp.json`, shell startup,
  or extension config unless the user approves the preview.

Return: current setup state, recommended setup action, and exact apply command
if approval is needed.

$ARGUMENTS
