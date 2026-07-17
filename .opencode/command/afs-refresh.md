---
description: refresh AFS search or context state when freshness matters
---

Refresh AFS state for the current registered project.

Rules:

- Start with `afs projects current --path . --json`.
- Inspect `afs repair --help` and use its preview before any mutating action.
- Apply only the narrow repair or index refresh the user requested.
- Never migrate layout, remap sources, or rebuild a large index implicitly.
- Treat later staleness as an advisory when sources and the index are healthy.
- Do not call session pack.

Summarize the scope, action, result, and remaining caveat.

$ARGUMENTS
