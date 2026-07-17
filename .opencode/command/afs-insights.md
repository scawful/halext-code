---
description: research the current AFS scope and review learning candidates
---

Use AFS Insights for scoped research, deterministic reflection, and human
review of learning candidates.

Request: `$ARGUMENTS`

Rules:

- Inspect `"${AFS_BIN:-${AFS_CLI:-afs}}" insights --help` and the selected
  subcommand help before an unfamiliar write. Do not invent flags for an older
  AFS installation.
- Keep scope exact:
  - `research` searches only the current registered project plus shared
    `common` context. It has no all-projects mode.
  - `reflect`, `list`, `show`, `accept`, and `reject` use the current project
    by default. `--common` selects shared context instead; it does not combine
    scopes.
- Start with local research, which refreshes the local index by default:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" insights research "<question>" --path . --json`

  Add `--reuse-index` only when using a possibly stale snapshot is intentional.

- Embedding-backed retrieval is a separate, explicit choice. Add `--semantic`
  only when the current request opts in. Prefer `--provider ollama` for local
  embeddings; `--provider gemini` transmits indexed content and the query to
  Gemini. State that data-movement boundary before running either provider.
- Internet research is a different permission from semantic retrieval. AFS
  ships no built-in internet provider. Run it only when the human explicitly
  selects an installed, enabled extension provider and supplies each allowed
  HTTPS domain:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" insights research "<question>" --path . --internet-provider <provider> --allow-domain <domain> --json`

  Never invent a provider, domain allowlist, credential path, or network
  consent. Extension provider code is trusted to enforce DNS, redirect,
  private-address, rebinding, and transport safety; AFS core only bounds the
  subprocess and validates returned evidence.

- Reflection is local and deterministic: it reads attributed, payload-free
  repeated failure history and creates only a pending candidate:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" insights reflect --path . --json`

  Use `list` and `show` to inspect candidates before any decision:

  `"${AFS_BIN:-${AFS_CLI:-afs}}" insights list --path . --json`

  `"${AFS_BIN:-${AFS_CLI:-afs}}" insights show <candidate-id> --path .`

- Accept or reject only after the human explicitly chooses the exact candidate
  and supplies the rationale verbatim through `--because`. Never infer or
  paraphrase the rationale, never provide the terminal confirmation token on
  the human's behalf, and never accept as a side effect of research or
  reflection. If an interactive human terminal is unavailable, stop and give
  the exact command for the human to run.

  `"${AFS_BIN:-${AFS_CLI:-afs}}" insights accept <candidate-id> --path . --because "<human rationale>"`

  `"${AFS_BIN:-${AFS_CLI:-afs}}" insights reject <candidate-id> --path . --because "<human rationale>"`

- Accepted candidates become durable notes with evidence provenance. Rejected
  candidates are archived. Agents and scheduled jobs have no promotion
  authority.

Return: the exact scope, whether local text/symbol, embeddings, or internet was
used, the provider/data-movement boundary, evidence or candidate IDs, and any
remaining human-review step.
