# Halext Porting Backlog

This file records what is still worth porting from the old `halext-code`
fork into the upstream-reset `halext-code-next` workspace.

## Decision boundary

- Python `afs` and `afs-scawful` remain the source of truth for AFS behavior.
- Opencode-side work stays inside upstream extension points:
  `.opencode/plugins`, `.opencode/tool`, `.opencode/agent`,
  `.opencode/command`, and skills.
- Anything that would revive a TypeScript AFS core, `@halext/cognitive`, or
  the old TUI stack is out of scope for the first migration wave.

## Evidence used

- The old fork is still large and invasive: `233 files changed`, with roughly
  `54.9k` inserted lines against the refreshed upstream sync base.
- The portable old integration points are concentrated in:
  `packages/opencode/src/tool/registry.ts`,
  `packages/tools/src/*.ts`, and
  `packages/core/src/agent.ts`.
- Most direct `@halext/*` imports in old opencode are TUI-only and clustered
  under `packages/opencode/src/cli/cmd/tui/**`.

## Classification

| Slice | Old fork evidence | Landing zone in `halext-code-next` | Decision |
| --- | --- | --- | --- |
| Repo-root `.context` defaults for AFS calls | `@halext/afs` root/path helpers, nested-dir breakage | `.opencode/plugins/afs-context.ts` | Keep and extend |
| AFS context, scratchpad, task, handoff, session operations | `afs-read`, `afs-write`, `plan-write`, `state-*` | `afs_local_*` MCP tools first | Prefer MCP, do not re-port as TS core |
| Skill catalog and reusable workflow prompts | old project conventions plus `afs-scawful` skills | `skills.paths` in `.opencode/opencode.jsonc` | Keep externalized |
| Session pack and handoff ergonomics | old state/plan workflow wrappers | `.opencode/command/*.md` if needed | Candidate command-only port |
| Custom harsh reviewer persona | `packages/core/src/agent.ts` `critic` agent | `.opencode/agent/critic.md` | Optional project agent |
| Raw history search convenience | `history-search.ts` | MCP first, maybe command wrapper later | Low-priority convenience only |
| Hivemind read/manage/promote/transfer | `hivemind-*.ts` plus `@halext/cognitive` | Python AFS MCP only | Do not port old implementation |
| Council vote and multi-agent promotion logic | `council-vote.ts` | none | Do not port |
| Cognitive state, theory-of-mind, emotional runtime | `@halext/cognitive`, `SPEC.md` | none | Do not port |
| Custom TUI panes, analysis modes, knowledge/state dashboards | `cli/cmd/tui/**`, `integration/halext.ts`, `@halext/tui` | none in phase 1 | Do not port |
| TypeScript AFS companion package | `packages/afs` | none | Do not port |
| Identity/orchestration side systems | `@halext/identity` and related imports | none | Do not port for now |

## What should actually be built

### 1. Keep the current thin AFS bridge

- Keep `afs_local` MCP configuration in `.opencode/opencode.jsonc`.
- Keep loading `afs-scawful` through `skills.paths`.
- Keep the repo-root `context_path` injection plugin and extend it only when a
  real MCP tool still fails from nested directories.

### 2. Prefer commands before new tools

If daily workflow friction remains, add thin slash-command wrappers before
adding new custom tools. The likely candidates are:

- `.opencode/command/afs-status.md`
- `.opencode/command/afs-work-preflight.md`
- `.opencode/command/afs-verify.md`
- `.opencode/command/afs-update-work.md`

These should call existing upstream or MCP surfaces, not recreate old
`@halext/tools` behavior.

### 3. Treat a `critic` agent as optional, not required

The only old custom agent behavior that looks independently portable is the
`critic` persona. If you still want it, recreate it as a project-local agent:

- `.opencode/agent/critic.md`

This is a style preference, not an AFS dependency, so it should stay out of
the core migration path.

### 4. Keep history and hivemind on the AFS side

- Use Python AFS MCP for `hivemind.*`, memory search, handoff, and session
  replay.
- Do not reintroduce the old `@halext/cognitive` store or the old
  promotion/council logic inside opencode.
- If a convenience gap remains, add a command wrapper, not a parallel runtime.

## Backlog order

1. Done: wire upstream opencode to local AFS MCP and `afs-scawful` skills.
2. Next: exercise the slim default MCP tools plus CLI-routed handoff, pack,
   work-preflight, and verification commands from a nested working directory.
3. Next: keep command aliases aligned with the AFS default command pack.
4. Optional: recreate the old `critic` behavior as a project-local agent.
5. Explicitly not planned: port `@halext/afs`, `@halext/cognitive`,
   `@halext/tui`, theory-of-mind, analysis panes, or the old council system.

## Exit criteria for phase 1

- Nested-directory AFS workflows work through upstream opencode without a
  local TypeScript AFS runtime.
- Session pack, handoff, and scratchpad flows are exercised end to end.
- No required feature depends on `@halext/*` workspace packages.
- Any surviving custom behavior lives under `.opencode/` and stays small
  enough to rebase easily onto future upstream releases.
