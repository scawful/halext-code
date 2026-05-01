---
description: show the repo-local AFS command menu and when to use each flow
---

Explain the repo-local AFS command surface for this workspace.

Keep it short and pragmatic. Include:

- `/afs-brief` for a cheap combined workspace briefing
- `/afs-help` for this menu
- `/afs-status` for a cheap workspace summary
- `/afs-query <question>` for context, knowledge, scratchpad, or memory lookup
- `/afs-files <path or intent>` for context-scoped read/list/write work
- `/afs-tasks` for current repo-local tasks
- `/afs-handoff [needle]` for recent or specific handoffs
- `/afs-handoff-create [note]` for writing a fresh handoff packet
- `/afs-review-context [topic]` for checking context health, drift, and missing
  AFS state before work or review
- `/afs-work-preflight [purpose]` for style evidence and approval guardrails
  before work-facing writing
- `/afs-verify [change]` for the fastest relevant verification pass
- `/afs-refresh` for explicit index or context refresh work when freshness
  matters
- `/afs-pack` for an explicit heavy handoff/export pack
- `/afs-update-work` for previewing/applying the AFS harness update path

Rules:

- Make it clear that `/afs-brief`, `/afs-status`, `/afs-query`, `/afs-tasks`,
  `/afs-files`, `/afs-handoff`, and `/afs-review-context` are the normal
  low-friction paths.
- Make it clear that `/afs-handoff-create` is an intentional write step, but
  still lighter than `/afs-pack`.
- Make it clear that `/afs-work-preflight` is mandatory before external work
  writing, and that posting/sending still requires explicit approval.
- Make it clear that `/afs-refresh`, `/afs-pack`, and `/afs-update-work` are
  intentional, heavier-weight actions.
- If the user supplied `$ARGUMENTS`, tailor the recommendation order to that
  intent.

$ARGUMENTS
