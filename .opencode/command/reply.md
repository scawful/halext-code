---
description: draft a work-safe reply with style evidence and approval guardrails
---

Draft work-facing communication safely.

Rules:

- Run the router:

  `~/src/lab/afs/scripts/afs next --path . --intent work-writing --json`

- Run the preflight it returns before drafting:

  `~/src/lab/afs/scripts/afs work communication preflight --path . --json`

- Use the returned style evidence, missing evidence, pending approvals,
  `ready_to_post`, and `requires_explicit_approval` guardrails.
- Draft locally only. Never post, send, submit, approve, or edit an external
  work system without explicit user approval for the exact target/action/preview.

Return: evidence used, draft, and approval/follow-up checklist.

$ARGUMENTS
