# AFS Integration

This workspace tracks upstream `anomalyco/opencode` on branch
`halext-reset` and keeps AFS as an external system, not a forked
TypeScript rewrite.

## Current shape

- OpenCode loads Python AFS through the local MCP server `afs_local`.
- OpenCode loads the broader `afs-scawful` skill catalog through
  `skills.paths`.
- OpenCode uses `.opencode/plugins/afs-context.ts` to ask
  `afs projects current --path <cwd> --json` for the authoritative central
  context root and project scope. It does not discover `.context` by walking
  parent directories.
- OpenCode uses the same plugin to bias the harness toward cheap AFS reads by
  default and keep `session_pack` explicit.
- For each live session, that plugin also requests the AFS `SessionStart`
  grounding block through `AFS_BIN`, then `AFS_CLI`, then `afs` on `PATH`. It
  uses an argument vector rather than a shell, caps runtime at 10 seconds and
  stdout at 32 KiB, coalesces concurrent requests, caps both cached and
  in-flight session sets at 32, and retries failures after a 30-second backoff.
- Project slash commands in `.opencode/command/` provide wrappers around the
  plain `afs start/search/files/notes/handoff/messages/projects/jobs/missions/insights/check/repair`
  vocabulary, plus `/afs-brief`, `/afs-help`, `/afs-review-context`,
  `/afs-work-preflight`, `/afs-verify`, `/afs-insights`, `/afs-refresh`,
  `/afs-pack`, and `/afs-update-work` flows.
- Short aliases cover the common daily paths: `/start`, `/find`, `/check`,
  `/ship`, `/reply`, `/handoff`, `/fixafs`, and `/setupafs`.
- The default Python AFS MCP catalog is intentionally slim: `context.status`,
  `context.query`, `context.search`, `context.read`, `context.write`,
  `context.list`, `skill.match`, `skill.read`, `messages.send`,
  `messages.read`, `note.create`, `note.read`, `note.list`, `handoff.create`,
  `handoff.read`, and `handoff.list`.
  Heavier AFS behavior is reached through CLI/framework hints or an explicit
  full-catalog AFS server.
- Project-local guidance lives in `.opencode/skills/halext-afs/SKILL.md`.
- Prompt-layer CLI recipes resolve `"${AFS_BIN:-${AFS_CLI:-afs}}"`; `scripts/hcode`
  derives `AFS_CLI` from `AFS_BIN`, then the overridable `AFS_ROOT`, while
  non-wrapper launches can provide either override or expose `afs` on `PATH`.
  When the CLI is overridden, the launcher leaves `AFS_VENV` unset unless the
  caller supplied it explicitly, so one checkout cannot inherit another's
  Python environment.
  On Windows, `AFS_BIN`/`AFS_CLI` must resolve to a native executable (normally
  the Python installer's `afs.exe` console launcher). The bridge and sidebar
  reject `.cmd`/`.bat` launchers rather than route request-derived arguments
  through a command shell.
  The project-local MCP command uses `AFS_CLI` directly because OpenCode config
  interpolation has no fallback syntax; non-wrapper launches that need the MCP
  server must set `AFS_CLI` explicitly.
- Project-local subagents under `.opencode/agent/` provide a small visible
  AFS-aware set for context, planning, review, worker, and critic lanes.
  Specialized exact-name agents exist for advanced flows, but slash commands
  remain the normal route.
- The current AFS MCP surface and proposed cleanup are documented in
  `docs/afs-tool-taxonomy.md`.
- The preferred operator entrypoint is stock opencode through `hcode`, not the
  experimental custom TUI.

## Feature mapping

- Session bootstrap, search, files, notes, jobs, scoped messages, handoff, and
  memory stay in Python AFS and come in through its CLI or MCP surface.
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
- Keep work-writing approval-gated. `/afs-work-preflight` gathers style
  evidence and approval state, but posting/sending still needs explicit human
  approval.
- The shell comms guardrail is a bounded defense-in-depth detector, not a proof
  that a command cannot communicate outward. It recognizes known literal comms
  commands, common execution wrappers, and inline shell scripts; dynamically
  constructed commands, aliases/functions, sourced scripts, encoded payloads,
  and arbitrary interpreter behavior remain outside its static detection scope.
- A detected communication request is remounted as its own permission prompt,
  shows the full command plus extracted draft, and offers only per-draft
  approval or rejection. Runtime `allow always` rules cannot release a queued
  guarded request.
- Repeated matching `session_pack` calls can reuse the stored pack artifact, so
  the command remains explicit but less volatile than a full rebuild every time.
- Treat a built-but-stale index as a refresh hint for search-heavy work, not as
  a default failure state.
- Keep Insights scoped and human-gated. Local text/symbol research is the
  default; embeddings and internet research are separate explicit choices.
  AFS ships no internet provider, so network research requires a named enabled
  extension plus allowed domains. Only a human may supply the rationale and
  complete terminal confirmation that promotes a candidate.

## Context discovery contract

- `afs_local` inherits opencode's working directory, but the context root is
  owned by AFS rather than inferred from that directory.
- The project plugin resolves the current project through
  `afs projects current --path <cwd> --json`, then injects the returned central
  `context_root` for supported tools.
- For v2 file tools, the plugin leaves category-relative paths relative and
  supplies `project_path` so AFS can resolve the authorized
  `<category>/projects/<project-id>/...` namespace. Old `.context/...`
  spellings are converted to category-relative form. V1 contexts retain the
  older absolute-root normalization for one compatibility cycle.
- If the CLI is unavailable, its JSON is malformed, or a v2 project is not
  registered, the plugin and sidebar fail closed and stay invisible. They do
  not fall back to a nearby directory named `.context`. CLI-resolved v1
  contexts with the `common` scope remain compatible for one transition cycle.
- If another AFS tool exposes a context issue later, extend the narrow plugin
  adapter instead of reintroducing TypeScript AFS logic.

## Preferred daily-driver flow

1. Launch stock opencode with `hcode` from the repo you want to work in.
2. Let the harness use cheap AFS reads automatically when needed.
3. Prefer the plain AFS surfaces for automation and agent instructions:
   - `afs start`
   - `afs search`
   - `afs files`
   - `afs notes`
   - `afs handoff`
   - `afs messages`
   - `afs projects`
   - `afs jobs`
   - `afs missions`
   - `afs insights`
   - `afs check`
   - `afs repair`
4. Use the short slash aliases for common interactive workflows:
   - `/start`: catch up and continue
   - `/find <topic>`: search context/scratchpad/prior decisions
   - `/check`: choose and run verification
   - `/ship`: scope, verify, and commit/push when explicitly requested
   - `/reply`: work-safe draft with communication preflight
   - `/handoff`: continuity note or handoff lookup
   - `/fixafs`: dry-run context/index repair
   - `/setupafs`: manager/setup preview
5. Use `/afs-next <intent>` only as a compatibility router when an older AFS
   installation lacks the plain command needed for the request.
   It calls `"${AFS_BIN:-${AFS_CLI:-afs}}" next --path . --intent <intent> --json`
   and records a small route event for later measurement.
6. Use `/afs-brief` for a combined workspace briefing, or
   `/afs-help` if you need the command menu.
7. Use `/afs-work-preflight` before work-facing writing and `/afs-verify` before
   calling a code change done.
8. Use `/afs-insights` for exact-scope research or deterministic reflection;
   keep embeddings, internet access, and candidate promotion explicit.
9. Use `/afs-refresh` only when stale search/index freshness actually matters.
10. Use `/afs-pack` only when you actually need a handoff/export artifact.
11. Use `/afs-update-work` to preview/apply the AFS harness update script from a
    work-machine checkout.

## Project agents

- `@afs-context`: cheap status/query/read/list context lookup.
- `@afs-planner`: AFS-aware planning without edits or full-catalog assumptions.
- `@afs-reviewer`: findings-first review with context and freshness caveats.
- `@afs-worker`: executes repo work while keeping scratchpad continuity.
- `@critic`: strict no-edit review for slop, overreach, regressions, and
  missing tests.
- Hidden exact-name agents exist for advanced verification, handoff,
  work-preflight, and operator lanes when explicit delegation is useful.

## Discovery ladder

Agents should use AFS in this order:

0. `afs start` for current scoped state.
1. `afs search` for cross-source retrieval.
2. `afs files` or `afs notes` for exact artifacts.
3. `afs handoff`, `afs messages`, `afs jobs`, or `afs missions` for the named
   durable flow.
4. `afs check` or `afs repair` for health and maintenance.
5. MCP `context.*` reads remain the cheap in-session path when already listed.

Use `"${AFS_BIN:-${AFS_CLI:-afs}}" next report --path . --json` when you want to
check whether recent agents used the funnel or bypassed it with heavy MCP
tools.

## Global agent sync

Use `scripts/afs-sync-agents` to copy the repo's AFS-oriented project agents
into your global OpenCode agent directory.

- Default behavior syncs `.opencode/agent/afs-*.md` into
  `~/.config/opencode/agent`.
- Use `--dry-run` to preview without writing.
- Use `--all` to sync every project agent markdown file.
- Use `--target <dir>` for an alternate destination.

## Next steps

1. Exercise the new slash-command flow in real stock-opencode sessions.
2. Keep `scripts/afs-hcode-smoke` green as the provider-free integration check;
   it creates and removes an isolated home, project, and central v2 context.
3. Extend wrapper coverage only if another AFS tool still needs explicit
   repo-root defaults.
4. Identify the smallest additional plugin or agent-layer additions still
   needed for halext behavior.
5. Use `docs/halext-porting-backlog.md` as the decision record for what gets
   ported versus explicitly left behind.
6. Use `docs/afs-tool-taxonomy.md` as the decision record for curating the AFS
   MCP surface without hard-splitting the primary server.
