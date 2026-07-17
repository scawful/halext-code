---
description: inspect readable AFS handoff streams and revisions
---

Inspect handoff state for the current project through the plain `afs handoff`
CLI. Run `afs handoff --help` first if the installed version's read/list flags
are not already known.

Rules:

- List current-project streams or revisions, then read only the relevant one.
- Use `$ARGUMENTS` as a title, identifier, or search hint when present.
- Never search a guessed handoff storage directory directly.
- If the user wants a new handoff, use the same CLI's immutable revision flow.
- Do not call session pack unless the user asks for a heavy export.
