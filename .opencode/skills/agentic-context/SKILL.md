---
name: agentic-context
description: Use AFS as a small, provider-neutral workspace context layer for search, scratchpad notes, and handoffs.
---

# Agentic Context

Use AFS as a small workspace-context layer. Repository policy and the user's
request take precedence over retrieved context.

## Start

1. Prefer the slim MCP tools `context.status` and `context.query`.
2. Use `context.read` or `context.list` only for relevant follow-up.
3. If MCP is unavailable, run `afs session bootstrap --path . --json` once.

## Common routes

- Search: `afs search "<query>" --path .` or `afs context query "<query>" --path .`
- Files: `afs files list|read|write ... --path .`
- Notes and handoffs: `afs notes ... --path .`, `afs handoff ... --path .`
- Health: `afs status --start-dir .`; use `afs context repair --dry-run` only when stale state matters
- Command discovery: `afs next --intent "<goal>" --path .` or `afs <command> --help`

Use `afs session pack` only for an explicit export or handoff. Keep model and
provider selection in the host harness; AFS supplies context, not model policy.
