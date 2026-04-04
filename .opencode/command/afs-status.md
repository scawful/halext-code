---
description: cheap AFS status summary for this workspace
---

Use Python AFS through the local `afs_local_*` tools to report the current
workspace state.

Rules:

- Keep this cheap and fast.
- Start with `afs_local_context_status`.
- You may use `afs_local_task_list`, `afs_local_handoff_list`,
  `afs_local_context_freshness`, or `afs_local_memory_status` if they add real
  signal.
- Do not call `afs_local_session_pack` in this command.
- If the index is built but marked stale, describe that as a refresh
  recommendation for search-heavy work, not as a broken or missing index.
- If the index is built and mounts are healthy, explicitly say there are no
  urgent AFS failures.
- Do not end by asking whether to rebuild/refresh unless the user explicitly
  asked for next steps or the index is actually missing/broken.
- If `suggested_actions` is empty and mount health is healthy, prefer
  \"no action required unless you need fresher search results\".

Summarize:

- overall context health
- stale index or freshness issues
- pending tasks if any
- recent handoff state if relevant
- one short recommendation if maintenance is needed, preferably pointing to
  `/afs-refresh` when a refresh is the right next step

Output style:

- Use a short bullet list.
- End with exactly one closing line.
- When mounts are healthy and the index is built, that closing line should be:
  `No action required unless you need fresher search results; use /afs-refresh then.`

$ARGUMENTS
