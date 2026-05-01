---
description: build an explicit AFS session pack for handoff or export
---

Create a session pack for this workspace using Python AFS.

Rules:

- This is the heavy AFS command.
- Use `~/src/lab/afs/scripts/afs session pack --path . --json` or MCP prompt
  `afs.session.pack` if prompts are exposed.
- Use MCP `afs_local_session_pack` only in an explicit full-catalog/debug
  session.
- Run it once unless the user explicitly asks for a retry with different
  inputs.
- If the result reports a cache hit or obvious artifact reuse, mention that so
  the user knows it did not rebuild the full pack.
- If it times out or fails, report that directly and suggest the likely cause
  instead of retrying in a loop.
- Do not pad the result with unrelated AFS reads unless needed to explain a
  failure.
- If the index is built but stale, describe that as a freshness caveat rather
  than saying the index is missing or the workspace is broken.

Summarize:

- whether the pack succeeded
- the most relevant contents or sections
- any timeout, freshness, or index caveat
- if a refresh would materially help, point to `/afs-refresh`

$ARGUMENTS
