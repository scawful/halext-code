---
description: inspect or update files in the current AFS project scope
---

Use the plain `afs files` surface or MCP `context.list/read/write` for:

`$ARGUMENTS`

Rules:

- Resolve the central root through `afs projects current`; never guess a local
  context directory.
- Treat `scratchpad` as the default writable working category.
- Treat `memory` and `knowledge` as deliberate durable updates.
- Do not delete or move files unless explicitly requested.
- Keep writes small and report the exact scoped path changed.
