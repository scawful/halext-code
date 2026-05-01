Route the current request through the deterministic AFS funnel.

Intent hint: `$ARGUMENTS`

Rules:

- Prefer this before browsing AFS docs, hidden agents, or nondefault MCP tools.
- If `$ARGUMENTS` is empty, use `continue`.
- Run the repo-local router:

  `~/src/lab/afs/scripts/afs next --path . --intent "$ARGUMENTS" --json`
- Follow the returned `first_step`, `mcp_sequence`, and first relevant command.
- Stop when the returned `stop_when` condition is satisfied.
- Do not call task, handoff, memory, work, repair, diff/freshness, or pack MCP
  tools unless the router or user explicitly routes there.
- If you need to measure whether agents are using the funnel, run:

  `~/src/lab/afs/scripts/afs next report --path . --json`

Return the selected route, what you did, and the next concrete action.
