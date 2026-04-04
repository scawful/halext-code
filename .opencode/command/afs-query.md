---
description: query AFS context, memory, scratchpad, and knowledge
---

Use Python AFS to answer this workspace-context question:

`$ARGUMENTS`

Rules:

- Start with `afs_local_context_query`.
- Use other cheap `afs_local_*` reads only if they materially improve the
  answer.
- Do not call `afs_local_session_pack` unless the user explicitly asks for a
  pack or handoff export.
- If the index is built but stale, still answer with the available context and
  mention freshness as an advisory caveat rather than a hard blocker.

Answer succinctly and include relevant context paths or source notes when they
help.
