# AFS Integration

This workspace tracks upstream `anomalyco/opencode` on branch
`halext-reset` and keeps AFS as an external system, not a forked
TypeScript rewrite.

## Current shape

- OpenCode loads Python AFS through the local MCP server `afs_local`.
- OpenCode loads the broader `afs-scawful` skill catalog through
  `skills.paths`.
- OpenCode uses `.opencode/plugins/afs-context.ts` to inject the repo-root
  `.context` for AFS tools that accept `context_path`.
- OpenCode uses the same plugin to bias the harness toward cheap AFS reads by
  default and keep `session_pack` explicit.
- Project-local slash commands in `.opencode/command/` provide first-class
  `/afs-brief`, `/afs-help`, `/afs-status`, `/afs-query`, `/afs-tasks`,
  `/afs-handoff`, `/afs-handoff-create`, `/afs-review-context`,
  `/afs-refresh`, and `/afs-pack` flows.
- Project-local guidance lives in `.opencode/skills/halext-afs/SKILL.md`.
- Project-local subagents under `.opencode/agent/` provide AFS-aware planner,
  reviewer, and worker roles for delegation without reviving a forked harness.
- The current AFS MCP surface and proposed cleanup are documented in
  `docs/afs-tool-taxonomy.md`.
- The preferred operator entrypoint is stock opencode through `hcode`, not the
  experimental custom TUI.

## Feature mapping

- Session bootstrap, context query, scratchpad access, task queue, hivemind,
  handoff, and memory search stay in Python AFS and come in through MCP.
- Reusable domain workflows stay in `afs-scawful` skills.
- Opencode-side work should stay limited to plugins, permissions, agents,
  prompts, and UX glue that are specific to current upstream.

## Guardrails

- Do not grow a new TypeScript AFS core in this repo.
- Do not make the custom TUI the primary path unless it clearly beats stock
  opencode for day-to-day use.
- Prefer upstream features first. Only add halext-specific code when the gap
  is real and opencode-specific.
- Keep heavyweight AFS work lazy. `session_pack` should be an explicit command,
  not ambient startup behavior.
- Repeated matching `session_pack` calls can reuse the stored pack artifact, so
  the command remains explicit but less volatile than a full rebuild every time.
- Treat a built-but-stale index as a refresh hint for search-heavy work, not as
  a default failure state.

## Current caveat

- `afs_local` inherits opencode's working directory.
- If opencode starts in a nested directory like `packages/opencode`,
  `context.*` tools that default to `cwd/.context` need an explicit
  `context_path` of `/Users/scawful/src/lab/halext-code-next/.context`.
- The project plugin now hides that detail for the supported AFS tools by
  forcing the repo-root `context_path` before execution, even if the model
  guessed the workspace root incorrectly.
- The same plugin also normalizes common `.context/...` and mount-relative file
  paths for `afs_local_context_read/list/write/move/delete`, which keeps the
  preferred `context.*` file surface usable from nested directories.
- If another AFS tool exposes the same issue later, extend the plugin instead
  of reintroducing TypeScript AFS logic.

## Preferred daily-driver flow

1. Launch stock opencode with `hcode` from the repo you want to work in.
2. Let the harness use cheap AFS reads automatically when needed.
3. Use `/afs-brief` for the cheapest combined workspace briefing, or
   `/afs-help` if you need the command menu.
4. Use `/afs-status`, `/afs-query`, `/afs-tasks`, `/afs-handoff`, or
   `/afs-review-context` for explicit AFS inspection.
5. Use `/afs-handoff-create` when you intentionally want a new continuity
   packet without paying for a full session pack.
6. Use `/afs-refresh` only when stale search/index freshness actually matters.
7. Use `/afs-pack` only when you actually need a handoff/export artifact.

## Next steps

1. Exercise the new slash-command flow in real stock-opencode sessions.
2. Keep `scripts/afs-hcode-smoke` green as the provider-free integration check.
3. Extend wrapper coverage only if another AFS tool still needs explicit
   repo-root defaults.
4. Identify the smallest additional plugin or agent-layer additions still
   needed for halext behavior.
5. Use `docs/halext-porting-backlog.md` as the decision record for what gets
   ported versus explicitly left behind.
6. Use `docs/afs-tool-taxonomy.md` as the decision record for curating the AFS
   MCP surface without hard-splitting the primary server.
