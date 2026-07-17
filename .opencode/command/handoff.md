---
description: inspect or create a readable scoped AFS handoff
---

Handle continuity through the plain AFS handoff surface.

Rules:

- Run `"${AFS_BIN:-${AFS_CLI:-afs}}" handoff --help` before an unfamiliar
  write so the installed AFS version defines the exact revision flags.
- For inspection, list the current project's streams and read only the relevant
  revision.
- For a new handoff, create an immutable readable revision with a short title,
  current state, changed files, verification, blockers, and next steps.
- Do not write an ad-hoc file under a guessed context path.
- Do not run session pack unless the user explicitly asks for a heavy export.

Return the stream/revision identifier or relevant existing handoff and the next
narrow step.

$ARGUMENTS
