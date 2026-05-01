---
description: find repo context, scratchpad notes, or prior decisions through AFS
---

Find relevant AFS context for the user's question.

Rules:

- Start with the router:

  `~/src/lab/afs/scripts/afs next --path . --intent context --json`

- If `$ARGUMENTS` names a topic, run a focused query:

  `~/src/lab/afs/scripts/afs query "$ARGUMENTS" --path . --limit 8 --json`

- Read exact files only when query results point to them.
- Do not broaden into memory/task/handoff MCP tools; route those through slash
  commands or the AFS CLI if needed.

Return source paths, freshness caveats, and the answer.
