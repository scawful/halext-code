# AFS Tool Taxonomy

This repo should keep a single full-capability AFS MCP server for the primary
agent path. The problem is not that AFS has too many total capabilities. The
problem is that one flat `afs_local_*` surface currently mixes quiet context
grounding, context-window continuity, coordination flows, and heavy
maintenance/admin operations.

## Decision

- Keep one main `afs_local` server for stock `hcode`, but let Python AFS expose
  a slim `tools/list` catalog by default.
- Do not hard-split the main harness into `core` and `admin` MCP servers for
  day-to-day use; use the full catalog only when explicitly requested.
- Treat handoff, work preflight, verification, refresh, repair, and session
  pack flows as CLI/framework or slash-command flows unless a full-catalog
  server is launched.
- Reduce cognitive load by making the default MCP list tiny and moving richer
  intent into commands, prompts, and AFS CLI hints.
- Reserve env-scoped tool allowlists or secondary MCP wrappers for specialized
  subagents and special clients, not for the primary daily-driver agent.

## Why not split the server

A hard `core`/`admin` split creates a new failure mode: the agent has to decide
which server family contains the needed operation before it can even use the
tool. That is worse than a broad single surface when the user is steering
real work and occasionally needs heavy operations like repair, refresh,
mounting, or process control.

The AFS server now also has a catalog seam: default launches expose a tiny
model-facing list, while `AFS_MCP_TOOL_CATALOG=full` or
`afs mcp serve --tool-catalog full` exposes the whole registry for migration,
debugging, or specialized clients. `AFS_ALLOWED_TOOLS` remains the stricter
permission seam for subagents, background agents, or external clients with a
different trust profile.

## Current shape

The current AFS MCP registry exposes a wide mixed surface in
`src/afs/mcp_server.py`:

- `briefing`: 1
- `context.*`: 10
- `fs.*`: 5
- `agent.*`: 5
- `hivemind.*`: 6
- `task.*`: 4
- `review.*`: 3
- `events.*`: 4
- `handoff.*`: 3
- `session.*`: 2
- `memory.*`: 2
- `embeddings.*`: 1

That shape is fine internally, but it is too flat for a default agent-facing
surface.

## Default surface

These are the only tools the primary agent should see in default `tools/list`:

- `context.status`
- `context.query`
- `context.read`
- `context.write`
- `context.list`

Notes:

- `context.diff` remains implemented and callable in the full catalog, but it
  is no longer part of the primary default list.
- `handoff.*`, `task.*`, `memory.*`, `work.*`, `context.repair`, and
  `session.pack` stay available through CLI/slash-command flows or full-catalog
  launches.
- `session.pack` remains explicit, not ambient.

## Command and CLI-routed flows

These are normal user-facing flows, but they should be reached through
slash-command prompts and AFS CLI/framework hints rather than default MCP tool
selection:

- `/afs-work-preflight`
- `/afs-verify`
- `/afs-handoff`
- `/afs-refresh`
- `/afs-pack`
- `/afs-update-work`
- `afs work communication preflight`
- `afs verify plan` / `afs verify run`
- `afs session pack`
- `afs context repair` / `afs index rebuild`
- `afs-upgrade-agent-setup --work`

## Full-catalog or lower-salience tools

These tools should remain callable by explicit full-catalog launches or
specialized wrappers, but they should not be the first thing the harness
suggests:

- `context.diff`
- `context.freshness`
- `task.create`
- `task.claim`
- `task.complete`
- `session.replay`
- `events.query`
- `events.tail`
- `events.analytics`
- `events.replay`
- `hivemind.send`
- `hivemind.read`
- `hivemind.subscribe`
- `hivemind.unsubscribe`
- `review.list`
- `context.repair`
- `context.index.rebuild`

## Advanced/admin operations

These are real capabilities, but they are heavy, mutating, or operational.
They should stay on the main server while being clearly described as explicit
maintenance/admin actions:

- `context.init`
- `context.mount`
- `context.unmount`
- `context.move`
- `context.delete`
- `embeddings.index`
- `agent.spawn`
- `agent.ps`
- `agent.stop`
- `agent.logs`
- `review.approve`
- `review.reject`
- `hivemind.cleanup`
- `hivemind.reap`

## Naming cleanup

The current `fs.*` versus `context.*` split is conceptually noisy in an
Agentic File System. For the agent-facing API, raw context-scoped file
operations should be expressed as context operations too.

Preferred agent-facing names:

- `context.read` instead of `fs.read`
- `context.write` instead of `fs.write`
- `context.list` instead of `fs.list`
- `context.move` instead of `fs.move`
- `context.delete` instead of `fs.delete`

Implementation guidance:

- The aliases are now implemented in Python AFS.
- Keep the old `fs.*` names working for compatibility.
- Prompts, skills, and slash commands should prefer the `context.*` names.
- Only remove or hide `fs.*` names later if the client ecosystem is ready.

## Opencode integration guidance

- Keep one `afs_local` server in `.opencode/opencode.jsonc`.
- Teach the slim default surface through the repo-local plugin, skill, and
  slash-command layer.
- Teach work preflight, verification, handoff, refresh, and setup/update
  through slash commands rather than re-expanding default `tools/list`.
- Keep heavyweight operations explicit in command names and tool descriptions.
- Do not ask the primary stock `build` agent to reason about multiple AFS MCP
  families when one server plus better curation will do.
- If a specialized subagent or external client needs a narrower scope, use
  `AFS_ALLOWED_TOOLS` wrappers around the same AFS MCP server.

## Current status

- Python AFS now exposes `context.read/write/list/move/delete` while
  preserving `fs.*` compatibility.
- The halext AFS plugin, skill guidance, and slash commands now prefer the slim
  default surface and the `context.*` names.
- `handoff.*` is still a first-class continuity flow, but not a default MCP
  listing.

## Remaining follow-on work

1. Keep slash commands and future prompts/examples aligned with the
   `context.*` names.
2. Only introduce extra MCP wrappers if a secondary client or subagent
   genuinely needs a different trust boundary.
