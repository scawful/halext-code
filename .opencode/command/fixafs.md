---
description: diagnose or repair AFS with the plain safe command
---

Diagnose AFS setup, scope, context, or index issues.

Rules:

- Start with `"${AFS_BIN:-${AFS_CLI:-afs}}" projects current --path . --json`.
- Inspect `"${AFS_BIN:-${AFS_CLI:-afs}}" repair --help`, then choose its
  non-mutating preview or narrowest safe action.
- Do not rebuild large indexes, remap sources, migrate layout, or start
  background agents without explicit user approval.
- Treat stale search data as an advisory unless the index is missing or its
  sources are unhealthy.

Return the diagnosis, preview, and safest next command.

$ARGUMENTS
