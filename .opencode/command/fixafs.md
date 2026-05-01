---
description: diagnose stale or broken AFS context without expanding the tool catalog
---

Diagnose and repair AFS setup, context, or index issues.

Rules:

- Run the router:

  `~/src/lab/afs/scripts/afs next --path . --intent refresh --json`

- Prefer dry-run repair first:

  `~/src/lab/afs/scripts/afs context repair --path . --dry-run --json`

- Do not rebuild large indexes, remap mounts, mutate client config, or start
  background agents unless the user explicitly approves that action.
- Report whether refresh is actually needed; stale index is often only a search
  freshness advisory.

Return: diagnosis, dry-run repair plan, and safest next command.

$ARGUMENTS
