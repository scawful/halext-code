---
description: inspect or register the current project with central AFS
---

Inspect AFS setup for this workspace.

Rules:

- Run `"${AFS_BIN:-${AFS_CLI:-afs}}" projects current --path . --json`.
- If layout v2 reports the project unregistered, inspect
  `afs projects register --help` and show the exact proposed registration
  command before applying it. Report a CLI-resolved v1 root as compatibility
  state rather than treating it as a v2 registration.
- Use `afs repair` only for a diagnosed context problem.
- Do not create a new local context root, migrate live data, or mutate harness
  config without explicit user approval.

Return current project/scope state and the narrowest approved setup action.

$ARGUMENTS
