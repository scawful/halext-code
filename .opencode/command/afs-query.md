---
description: search AFS context, notes, memory, and knowledge
---

Search the current registered AFS project for:

`$ARGUMENTS`

Rules:

- Prefer the plain `afs search` CLI; inspect `afs search --help` before using
  version-specific flags.
- In an already connected slim MCP session, `afs_local_context_query` is an
  acceptable cheap equivalent.
- Read exact files only when results point to them.
- Never broaden to all projects implicitly.
- Report semantic fallback or stale-index state as an honest caveat.
- Do not call `afs_local_session_pack`.

Answer succinctly and include relevant source paths.
