# AFS Tool Taxonomy

This repo should keep a single full-capability AFS MCP server for the primary
agent path. The problem is not that AFS has too many total capabilities. The
problem is that one flat `afs_local_*` surface currently mixes quiet context
grounding, context-window continuity, coordination flows, and heavy
maintenance/admin operations.

## Decision

- Keep one main `afs_local` server for stock `hcode`.
- Do not hard-split the main harness into `core` and `admin` MCP servers.
- Treat `handoff.*` as a core continuity surface, not as a multi-agent-only
  feature.
- Reduce cognitive load by curating a blessed default surface and by cleaning
  up tool naming, not by removing capability from the main agent.
- Reserve env-scoped tool allowlists or secondary MCP wrappers for specialized
  subagents and special clients, not for the primary daily-driver agent.

## Why not split the server

A hard `core`/`admin` split creates a new failure mode: the agent has to decide
which server family contains the needed operation before it can even use the
tool. That is worse than a broad single surface when the user is steering
real work and occasionally needs heavy operations like repair, refresh,
mounting, or process control.

The AFS server already has a real scoping seam through `AFS_ALLOWED_TOOLS`.
That should be used for specialized subagents, background agents, or external
clients with a different trust profile. It should not be the default shape of
the main stock-opencode harness.

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

## Blessed default surface

These are the tools the primary agent should be taught to prefer first:

- `briefing`
- `context.status`
- `context.query`
- `context.diff`
- `context.freshness`
- `context.read`
- `context.list`
- `task.list`
- `handoff.list`
- `handoff.read`
- `handoff.create`
- `memory.status`
- `memory.search`
- `session.pack`

Notes:

- `handoff.create` stays in the default surface because it is useful for
  context-window steering and user-managed continuity, not just multi-agent
  workflows.
- `session.pack` stays available but should remain explicit, not ambient.

## Available but lower-salience

These tools should remain callable by the main agent, but they should not be
the first thing the harness suggests:

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
- `context.write`
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
- Teach the blessed default surface through the repo-local plugin, skill, and
  slash-command layer.
- Keep heavyweight operations explicit in command names and tool descriptions.
- Do not ask the primary stock `build` agent to reason about multiple AFS MCP
  families when one server plus better curation will do.
- If a specialized subagent or external client needs a narrower scope, use
  `AFS_ALLOWED_TOOLS` wrappers around the same AFS MCP server.

## Current status

- Python AFS now exposes `context.read/write/list/move/delete` while
  preserving `fs.*` compatibility.
- The halext AFS plugin and skill guidance now prefer the blessed default
  surface and the `context.*` names.
- `handoff.*` remains in the default continuity surface.

## Remaining follow-on work

1. Keep slash commands and future prompts/examples aligned with the
   `context.*` names.
2. Only introduce extra MCP wrappers if a secondary client or subagent
   genuinely needs a different trust boundary.
