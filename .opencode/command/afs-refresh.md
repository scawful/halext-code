---
description: refresh AFS context health when stale search/index freshness actually matters
---

Refresh AFS context state for this workspace.

Rules:

- Prefer the lightest repair that matches the issue.
- First run `"${AFS_BIN:-${AFS_CLI:-afs}}" context repair --path . --dry-run --json`.
- If the problem is a stale or missing index, run
  `"${AFS_BIN:-${AFS_CLI:-afs}}" index rebuild --path . --json` or
  `"${AFS_BIN:-${AFS_CLI:-afs}}" context repair --path . --rebuild-index --json`.
- Use MCP repair/rebuild tools only in an explicit full-catalog/debug session.
- Report what you refreshed and whether lightweight AFS reads should now be
  more trustworthy.
- Do not call session pack in this command.
- If a later status still says `stale`, frame that as a freshness advisory from
  ongoing mount drift unless the index is missing or mount health is actually
  unhealthy.

Summarize:

- what action ran
- whether it succeeded
- whether search-heavy AFS operations should now be fresher
- any remaining caveat

$ARGUMENTS
