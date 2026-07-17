---
description: cheap AFS health summary for the current registered project
---

Report current AFS state without a heavy pack.

Rules:

- Resolve scope with `afs projects current --path . --json`.
- Prefer the plain `afs check` health surface; inspect its `--help` before
  version-specific flags.
- In an already connected slim MCP session, `afs_local_context_status` is an
  acceptable cheap equivalent.
- Use search or exact file reads only when they add real signal.
- Treat a built-but-stale index as a search advisory, not a default failure.
- Do not repair, rebuild, or run session pack.

Summarize project scope, context health, search freshness, and one short
recommendation only if maintenance is needed.

$ARGUMENTS
