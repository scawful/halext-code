---
name: halext-afs
description: Use Python AFS through afs_local and keep halext work on the upstream-reset path.
compatibility: opencode
---

## When to use me

Use this when work in `halext-code-next` touches context, session state,
scratchpad, handoffs, jobs, knowledge lookup, or AFS migration choices.

## Working rules

- Prefer the `afs_local_*` MCP tools over rebuilding AFS behavior in
  TypeScript.
- Prefer the plain AFS CLI vocabulary: `start`, `search`, `files`, `notes`,
  `handoff`, `messages`, `projects`, `jobs`, `missions`, `check`, and `repair`.
  Use `/afs-next <intent>` only as a compatibility router for an older AFS
  installation.
- Prefer short aliases for common daily workflows: `/start`, `/find`, `/check`,
  `/ship`, `/reply`, `/handoff`, `/fixafs`, and `/setupafs`.
- Project slash commands remain useful wrappers for interactive work, notably
  `/afs-brief`, `/afs-review-context`, `/afs-work-preflight`, `/afs-verify`,
  `/afs-refresh`, `/afs-pack`, and `/afs-update-work`.
- Use `/afs-help` when the right AFS command is unclear or when a user needs a
  lightweight menu of the available flows.
- Follow the scoped discovery ladder: start -> search -> exact files/notes ->
  named handoff/messages/jobs/missions -> check/repair.
- Use `afs_local_context_query` before asking for context that may already
  exist in knowledge, memory, scratchpad, or history.
- Prefer the slim default MCP surface first: `afs_local_context_status`,
  `afs_local_context_query`, `afs_local_context_search`,
  `afs_local_context_read`, `afs_local_context_write`,
  `afs_local_context_list`, `afs_local_messages_send`,
  `afs_local_messages_read`, `afs_local_note_create`, `afs_local_note_read`,
  `afs_local_note_list`, `afs_local_handoff_create`, `afs_local_handoff_read`,
  and `afs_local_handoff_list`.
- Route work preflight, verification, handoff lifecycle, refresh, repair, and
  session pack flows through slash commands or the AFS CLI unless the session
  was explicitly launched with the full AFS MCP catalog.
- Prefer `afs_local_context_read` and `afs_local_context_write` for scratchpad
  and other `.context` file work. The older `afs_local_fs_read` and
  `afs_local_fs_write` names remain compatible aliases.
- For v2 `afs_local_context_read/list/write`, prefer category-relative paths;
  the plugin supplies `project_path` so AFS can authorize and resolve the
  current project namespace. Absolute paths under the CLI-resolved root remain
  the v1 compatibility convention. The plugin converts old `.context/...`
  spellings without making them cross project boundaries.
- Do not assume full-catalog coordination, task, handoff lifecycle, memory,
  `afs_local_context_diff`, or
  `afs_local_context_freshness` exist in normal hcode sessions. Use slash
  commands or the AFS CLI unless a full-catalog session was requested.
- Treat `afs_local_session_pack` as an explicit heavy step, not a default.
  Use it when the user asks for a pack or when a real handoff/export is needed.
  Repeated matching calls may reuse the stored pack artifact instead of
  rebuilding from scratch.
- Treat a built-but-stale index as a freshness advisory for search-heavy work,
  not a default failure state.
- The project plugin `.opencode/plugins/afs-context.ts` injects the launch
  `project_path` and central `context_path` authorized by
  `afs projects current`.
- Trust an absolute v1 compatibility root explicitly returned by AFS. For v2,
  if project discovery fails or reports the project unregistered, do not guess
  a context path; register or repair the project through AFS first.
- Role cues:
  - planner/reviewer subagents should stay on cheap AFS reads
  - context lookup should normally use `@afs-context`, not a broad search over
    every AFS feature
  - context/verifier/work/operator subagents should route heavier AFS flows to
    slash commands or CLI
  - worker and handoff subagents may use central-context file writes in scratchpad
  - `session_pack` stays explicit for every role

## Source of truth

- `/Users/scawful/src/lab/afs` owns bootstrap, indexing, memory, jobs,
  messages, handoff, and MCP behavior.
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

1. Start with `"${AFS_BIN:-${AFS_CLI:-afs}}" start --path . --json` or the
   `/start` alias.
2. Use the named plain command for the next intent: search, files, notes,
   handoff, messages, projects, jobs, missions, check, or repair. Inspect that
   command's `--help` before using an unfamiliar write flag.
3. Check current state with `/afs-brief`, `afs_local_context_status`, or
   `afs_local_context_query`.
4. Read scratchpad or handoff state with `afs_local_context_read`.
5. Use `/afs-help` if you need the command menu, `/afs-review-context` when
   context health or drift is the main question, and `/afs-refresh` only when a
   stale index actually matters.
6. Use `/afs-work-preflight` before work-facing writing and do not post/send
   externally without explicit approval.
7. Use `/afs-verify` before calling code changes done.
8. Use `afs jobs`, `afs missions`, or `afs handoff` when work spans multiple
   steps or sessions.
9. Pack session state only when you explicitly need a handoff/export artifact.
