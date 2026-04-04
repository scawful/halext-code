---
name: halext-afs
description: Use Python AFS through afs_local and keep halext work on the upstream-reset path.
compatibility: opencode
---

## When to use me

Use this when work in `halext-code-next` touches context, session state,
scratchpad, handoffs, tasks, knowledge lookup, or AFS migration choices.

## Working rules

- Prefer the `afs_local_*` MCP tools over rebuilding AFS behavior in
  TypeScript.
- Prefer the repo-local slash commands `/afs-brief`, `/afs-status`,
  `/afs-query`, `/afs-tasks`, `/afs-handoff`, `/afs-handoff-create`,
  `/afs-review-context`, `/afs-refresh`, and `/afs-pack` when they fit the
  user's intent.
- Use `/afs-help` when the right AFS command is unclear or when a user needs a
  lightweight menu of the available flows.
- Use `afs_local_context_query` before asking for context that may already
  exist in knowledge, memory, scratchpad, or history.
- Prefer the blessed default surface first: `afs_local_context_status`,
  `afs_local_context_query`, `afs_local_context_diff`,
  `afs_local_context_freshness`, `afs_local_context_read`,
  `afs_local_context_list`, `afs_local_task_list`,
  `afs_local_handoff_list`/`read`/`create`, and
  `afs_local_memory_status`/`search`.
- Prefer `afs_local_context_read` and `afs_local_context_write` for scratchpad
  and other `.context` file work. The older `afs_local_fs_read` and
  `afs_local_fs_write` names remain compatible aliases.
- For `afs_local_context_read/list/write/move/delete`, prefer absolute paths
  under `/Users/scawful/src/lab/halext-code-next/.context`. The project plugin
  also normalizes common `.context/...` and mount-relative paths.
- Use `afs_local_task_*`, `afs_local_hivemind_*`, and `afs_local_handoff_*`
  for multi-step work and handoffs.
- Treat `afs_local_session_pack` as an explicit heavy step, not a default.
  Use it when the user asks for a pack or when a real handoff/export is needed.
  Repeated matching calls may reuse the stored pack artifact instead of
  rebuilding from scratch.
- Treat a built-but-stale index as a freshness advisory for search-heavy work,
  not a default failure state.
- The project plugin `.opencode/plugins/afs-context.ts` injects the repo-root
  `context_path` for the AFS tools that support it.
- If a nested-directory session still hits a context error, pass
  `context_path: "/Users/scawful/src/lab/halext-code-next/.context"`
  explicitly.
- Role cues:
  - planner/reviewer subagents should stay on cheap AFS reads
  - worker subagents may use `.context` file tools plus task or handoff writes
  - `session_pack` stays explicit for every role

## Source of truth

- `/Users/scawful/src/lab/afs` owns bootstrap, indexing, memory, tasks,
  hivemind, handoff, and MCP behavior.
- `/Users/scawful/src/lab/afs-scawful/skills` owns the reusable domain skill
  catalog loaded by this workspace.

## Migration guardrails

- Do not revive the old TypeScript `@halext/afs` parity plan in this repo.
- Keep changes thin: MCP wiring, skill loading, plugins, agent config, and
  narrow opencode-specific glue.
- Add missing cross-project capabilities to Python AFS or `afs-scawful`
  before adding new TypeScript subsystems here.
- Keep stock opencode as the primary harness path; treat custom TUI or desktop
  surfaces as secondary experiments unless they earn their way back in.

## Preferred flow

1. Check current state with `/afs-brief`, `afs_local_context_status`, or
   `afs_local_context_query`.
2. Read scratchpad or handoff state with `afs_local_context_read`.
3. Use `/afs-help` if you need the command menu, `/afs-review-context` when
   context health or drift is the main question, and `/afs-refresh` only when a
   stale index actually matters.
4. Use `/afs-tasks`, `/afs-handoff`, `/afs-handoff-create`, or the underlying
   tools when the work spans multiple steps.
5. Pack session state only when you explicitly need a handoff/export artifact.
