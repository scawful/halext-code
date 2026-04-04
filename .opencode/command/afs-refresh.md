---
description: refresh AFS context health when stale search/index freshness actually matters
---

Refresh AFS context state for this workspace.

Rules:

- Prefer the lightest repair that matches the issue.
- If the problem is a stale or missing index, use
  `afs_local_context_index_rebuild`.
- Use `afs_local_context_repair` only if the tool output clearly suggests a
  broader context repair problem.
- Report what you refreshed and whether lightweight AFS reads should now be
  more trustworthy.
- Do not call `afs_local_session_pack` in this command.
- If a later status still says `stale`, frame that as a freshness advisory from
  ongoing mount drift unless the index is missing or mount health is actually
  unhealthy.

Summarize:

- what action ran
- whether it succeeded
- whether search-heavy AFS operations should now be fresher
- any remaining caveat

$ARGUMENTS
