---
description: quick AFS catch-up for the current workspace
---

Catch up quickly before continuing work.

Rules:

- Use this instead of browsing AFS docs or the full MCP catalog.
- Run the deterministic router:

  `~/src/lab/afs/scripts/afs next --path . --intent continue --json`

- Follow the returned first step. Usually that means cheap status, then a
  targeted query/read only if prior state is actually needed.
- Prefer `/afs-brief` only if the user wants a fuller workspace brief.
- Do not call task, handoff, memory, repair, freshness, or pack MCP tools unless
  the router or user explicitly routes there.

Return: current state, any blocker/handoff signal, and the next concrete action.

$ARGUMENTS
