---
description: quick AFS catch-up for the current project scope
---

Catch up quickly before continuing work.

Rules:

- Run `"${AFS_BIN:-${AFS_CLI:-afs}}" start --path . --json`.
- For layout v2, stop and explain if AFS says the project is unregistered; do
  not guess a nearby `.context` directory. Trust a v1 compatibility root only
  when AFS explicitly returns it.
- Search or read exact artifacts only when the start packet shows they matter.
- Use `afs missions` when durable goals are relevant.
- Use `/afs-brief` only when the user wants a fuller workspace brief.
- Do not run repair or build an export pack unless the user requested it.

Return current state, the project scope, blockers, and the next concrete action.

$ARGUMENTS
