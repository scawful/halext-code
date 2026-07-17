---
description: show the plain AFS command menu and project wrappers
---

Explain the AFS command surface for this workspace.

Lead with the plain CLI vocabulary:

- `afs start`: catch up in the current AFS-resolved project scope
- `afs search`: hybrid context and knowledge search
- `afs files`: exact context-scoped file operations
- `afs notes`: readable working and durable notes
- `afs handoff`: inspect or create immutable continuity revisions
- `afs messages`: scoped inter-agent messages
- `afs projects`: inspect or register central-context projects
- `afs jobs`: bounded background or one-shot work
- `afs missions`: durable goals that outlive a session
- `afs insights`: exact-scope research and human-reviewed learning candidates
- `afs check`: AFS health checks
- `afs repair`: explicit diagnosis and repair

Tell the user to inspect `<command> --help` before an unfamiliar write because
flags can differ across compatible AFS versions. Do not invent note or handoff
flags.

Then mention the small project wrappers that add hcode-specific policy:

- `/start`, `/find`, `/check`, `/handoff`, and `/fixafs` for daily work
- `/afs-brief` for a combined workspace briefing
- `/afs-review-context` for context health and drift review
- `/afs-work-preflight` before work-facing writing
- `/afs-verify` before calling a code change done
- `/afs-approvals` for pending requests; resolve only on explicit human direction
- `/afs-schema` for structured-response validation
- `/afs-optimize` for deterministic evidence review, never automatic promotion
- `/afs-insights` for scoped research, deterministic reflection, and human-only
  learning review
- `/afs-refresh` for an intentional search/index refresh
- `/afs-pack` for an explicit heavy export
- `/afs-update-work` for a reviewed harness update
- `/afs-next` only as a compatibility router for older AFS installations

Rules:

- Keep the menu short and use plain user-facing terms.
- Make clear that central context is resolved by `afs projects current`, not by
  searching parent directories for `.context`.
- Keep the default MCP catalog slim; prefer a named CLI flow instead of browsing
  the full catalog.
- Keep writes scoped to the current project unless the user explicitly requests
  an all-project operation.
- Never resolve approvals, send external communications, or promote an
  optimization or insight candidate without explicit human direction. Insight
  promotion also requires the human to complete the terminal confirmation.
- If `$ARGUMENTS` is present, recommend only the smallest relevant sequence.

$ARGUMENTS
