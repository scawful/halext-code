# Halext Alternate Entry Points

This workspace keeps multiple operator entry points on purpose. Use the one
that fits the task instead of forcing everything through a single UI.

## 1) `hcode` (primary daily-driver)

Use this for normal coding, tool calls, and AFS-aware chat workflows.

- Command: `hcode`
- Backed by: upstream `packages/opencode` TUI
- AFS path: `afs_local` MCP + `.opencode/plugins/afs-context.ts`
- Best for: day-to-day coding loops and slash command workflows

Recommended AFS commands in this mode:

- `/afs-brief`
- `/afs-status`
- `/afs-query`
- `/afs-files`
- `/afs-tasks`
- `/afs-handoff`
- `/afs-work-preflight`
- `/afs-verify`
- `/afs-pack`

## 2) Halext Workbench (AFS operator surface)

Use this when you want a dashboard-like lane for sessions plus AFS context
state, with file browsing and previews.

- Command: `bun run dev:workbench`
- Package: `packages/halext-workbench`
- Backed by:
  - opencode SDK (`@opencode-ai/sdk`) for sessions/messages/events
  - halext bridge (`@halext/bridge`) for AFS-specific read models

### Workbench features

- Project/session rail
- Live session canvas (queued + streaming aware)
- AFS bootstrap summary lane
- AFS session-pack preview lane
- AFS Explorer lane:
  - `AFS focus` mode prioritizing `.context` and mount directories
  - `Show all` filesystem mode
  - mount quick-jump chips (`scratchpad`, `items`, `hivemind`, etc)
  - file preview

## 3) Halext Bridge (AFS read-model API)

Run this when using workbench or any other local UI that needs stable AFS
read endpoints.

- Command: `bun run dev:bridge`
- Package: `packages/halext-bridge`
- Default URL: `http://127.0.0.1:4319`

### Current bridge endpoints

- `GET /health`
- `GET /api/summary` (AFS bootstrap summary)
- `GET /api/session/pack` (session-pack preview)
- `GET /api/fs/list` (root-scoped file tree)
- `GET /api/fs/read` (root-scoped file preview)

Bridge endpoints are read-only by design for now.

## 4) Theme + terminal profile entrypoint

Use this when you want the hcode look-and-feel across both TUI and terminal.

- TUI config: `.opencode/tui.json`
- Custom theme: `.opencode/themes/hcode-ghostty.json`
- Ghostty override: `ghostty/hcode-ghostty.conf`

To enable Ghostty overrides, add:

- `config-file = /Users/scawful/src/lab/halext-code/ghostty/hcode-ghostty.conf`

to your Ghostty config and restart Ghostty.

## Which one to pick?

- **Coding + tool calls**: `hcode`
- **AFS dashboard + explorer**: workbench + bridge
- **Visual polish**: custom TUI theme + Ghostty override
