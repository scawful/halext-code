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
- `/afs-missions`
- `/afs-approvals`
- `/afs-schema`
- `/afs-optimize`
- `/afs-pack`

## 2) Halext Workbench (AFS operator surface, deprioritized)

Status: on ice. The terminal surfaces (`hcode` sidebar and halext-tui) now
cover the AFS dashboard role with fewer moving parts — the workbench needs
both the bridge and an opencode server running to be useful. It still works,
but new AFS features land in the terminal surfaces first.

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

## 3) Halext TUI (terminal cockpit)

Use this when you want the workbench-style operator view without leaving the
terminal: sessions, timeline, and a live AFS lane side by side.

- Command: `bun run halext-tui` (boots the opencode server and bridge if
  needed, then launches the cockpit)
- Package: `packages/halext-tui`
- Layout: Sessions rail | Timeline | AFS lane (shown when the terminal is at
  least 128 columns wide)
- AFS lane shows: index status, phase, MCP servers, open tasks, latest
  handoff, active missions, pending approvals, and an optional pack preview
- Keys: `j/k` select session, `i` compose, `n` new session, `r` refresh,
  `p` pack preview, `h` AFS health check, `q` quit

The approvals section is display-only. Resolving an approval stays a
deliberate CLI step (`afs approvals approve|reject`) on explicit user
direction, never a cockpit shortcut.

## 4) Halext Bridge (AFS read-model API)

Run this when using workbench, halext-tui, or any other local UI that needs
stable AFS read endpoints.

- Command: `bun run dev:bridge`
- Package: `packages/halext-bridge`
- Default URL: `http://127.0.0.1:4319`

### Current bridge endpoints

- `GET /health` (bridge process health)
- `GET /api/summary` (AFS bootstrap summary)
- `GET /api/session/pack` (session-pack preview)
- `GET /api/missions` (durable missions; `status`/`limit`/`path` filters)
- `GET /api/approvals` (approval requests; optional `status` filter)
- `GET /api/health` (AFS system health check via `afs health status`)
- `GET /api/fs/list` (root-scoped file tree)
- `GET /api/fs/read` (root-scoped file preview)

Bridge endpoints are read-only by design. Mutating flows (approving
requests, updating missions) intentionally stay in the AFS CLI.

## 5) Theme + terminal profile entrypoint

Use this when you want the hcode look-and-feel across both TUI and terminal.

- TUI config: `.opencode/tui.json`
- Custom theme: `.opencode/themes/hcode-ghostty.json`
- Ghostty override: `ghostty/hcode-ghostty.conf`

To enable Ghostty overrides, add:

- `config-file = /Users/scawful/src/lab/halext-code/ghostty/hcode-ghostty.conf`

to your Ghostty config and restart Ghostty.

## Which one to pick?

- **Coding + tool calls**: `hcode`
- **AFS dashboard in the terminal**: halext-tui
- **AFS dashboard + explorer (browser, deprioritized)**: workbench + bridge
- **Visual polish**: custom TUI theme + Ghostty override
