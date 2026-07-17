---
description: create an immutable readable AFS handoff revision
---

Create a scoped handoff through the plain `afs handoff` CLI.

Rules:

- Inspect `"${AFS_BIN:-${AFS_CLI:-afs}}" handoff --help` before writing; do not
  invent version-specific flags.
- Require a short readable title and include current state, changed files,
  verification, blockers, and next steps.
- Fold `$ARGUMENTS` into the title or operator note when useful.
- Let AFS assign the unique readable revision filename and scope metadata.
- Do not write an ad-hoc context file and do not run session pack.

Return the stream/revision identifier and a concise summary.
