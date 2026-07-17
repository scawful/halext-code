---
description: search current-project context and prior decisions through AFS
---

Find relevant AFS context for the user's question.

Rules:

- Resolve the project through AFS; never infer context from a local `.context`.
- Inspect `"${AFS_BIN:-${AFS_CLI:-afs}}" search --help` if needed, then run the
  smallest focused `afs search` in the current project scope for `$ARGUMENTS`.
- Prefer hybrid results and read exact files only when a result points to them.
- Expand to all projects only when the user explicitly requests it.
- Report search fallback or index freshness honestly.

Return source paths, scope, freshness caveats, and the answer.
