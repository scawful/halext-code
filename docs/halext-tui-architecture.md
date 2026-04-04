# Halext TUI Architecture

`packages/halext-tui` is now the primary custom UX direction for halext-code-next.

## Boundary

- `packages/opencode` remains the engine, server, and upstream TUI reference.
- `packages/halext-tui` is a separate terminal app built on `@opentui/solid`.
- The data seam stays the same as the web spike:
  - `@opencode-ai/sdk` for projects, sessions, messages, and MCP state
  - `@halext/bridge` for AFS summary and session-pack reads

## Internal import policy

- Exported package surfaces are preferred when they are sufficient.
- Upstream TUI internals may be consumed for research work when they save time.
- If we cross that line, keep the imports behind a small local adapter layer in
  `packages/halext-tui/src/upstream/*` so upstream churn is fixed in one place.
- Avoid importing the whole upstream TUI app or route tree as a single unit
  unless we intentionally accept a much tighter coupling.

## Phase 1 scaffold

- Session rail with keyboard selection.
- Timeline view for the selected session.
- Minimal prompt composer with local input mode and async prompt submission.
- AFS lane for context summary, queued tasks, handoff preview, MCP status, and
  on-demand pack preview.
- No upstream patching and no TypeScript AFS runtime.

## Near-term goal

Make `halext-tui` a terminal-first operator cockpit that is useful even if the
raw coding harness remains stronger in Codex or Claude Code. The differentiator
is session, context, task, and handoff visibility in one terminal surface.

## Current gap

- `halext-tui` can now create a session and send a prompt through opencode.
- The next useful upgrade is live event-driven session updates so assistant,
  tool, and status changes do not depend on manual refreshes or delayed polling.
