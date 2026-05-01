# Halext Workbench Architecture

`packages/halext-workbench` was the first deliberate step toward a custom UX
that did not require patching the upstream opencode app.

It is now a side experiment. The primary direction has shifted to
`packages/halext-tui` for a terminal-first operator surface.

## Boundary

- `packages/opencode` remains the engine and server.
- `packages/halext-workbench` is a separate Solid app that talks to the engine
  through `@opencode-ai/sdk`.
- Shared visual primitives come from `@opencode-ai/ui`.
- Stable app-level providers like `AppBaseProviders` may be reused, but the
  workbench must not import upstream `packages/app/src/pages/*` internals.

## Current scaffold

- Connection bar for server URL and project directory.
- Left rail for projects and recent sessions.
- Main session canvas that can load messages, queue prompts asynchronously,
  update from the upstream global event stream, and render structured message
  parts directly from exported SDK data.
- The current workbench also keeps lightweight session activity and optimistic
  prompt state locally so queued and streaming work is visible before a full
  message refresh lands.
- Right lane for MCP status and the future AFS-first surfaces.

This is intentionally enough to prove the replacement boundary:
the custom package already speaks to the opencode engine without reusing the
upstream route tree.

## Reuse rules

- Depend on exported packages, not source file paths.
- If a visual primitive is useful across both apps, move it into
  `@opencode-ai/ui`.
- If a transport or engine surface is missing, add it to the SDK/server
  boundary instead of importing engine internals into the workbench.

## Follow-on packages

- `packages/halext-desktop`
  A dedicated native host for the custom workbench, if the web app proves out.
- `packages/halext-bridge`
  A tiny companion service for AFS-specific read models that are awkward through
  existing opencode APIs. Phase 1 keeps it read-only and backed by supported AFS
  CLI commands instead of a TypeScript AFS runtime.

## Phase 1 goal

Keep the workbench opinionated at the UX layer while keeping the engine
upstream-compatible. The package should make it easier to surface sessions,
tasks, handoffs, and context together without turning into another fork of the
main opencode UI.

## Current bridge contract

- `halext-bridge` exposes a bootstrap summary read for context health,
  scratchpad, queued tasks, and the latest handoff.
- `halext-bridge` exposes an on-demand `session pack` preview for richer cited
  context without writing artifacts on every UI refresh.
- `halext-bridge` now also exposes root-scoped file listing/preview reads
  (`/api/fs/list`, `/api/fs/read`) so workbench can provide an AFS Explorer
  lane without importing opencode internals.
- Session and message liveliness should come from the exported opencode SDK
  event stream, while AFS-specific reads continue to come from the bridge.
- Write flows stay out of scope until a future pass proves a real need beyond
  the current read-only AFS lane.

## Operator entrypoint map

For the current list of supported operator entry points (`hcode`,
workbench+bridge, theme/terminal profile), see `docs/halext-entrypoints.md`.
