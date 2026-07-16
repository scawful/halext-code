---
description: run the deterministic AFS optimization decision gate on evidence
---

Compare optimization evidence with the deterministic AFS decision gate.

Request: `$ARGUMENTS`

Rules:

- The gate is pure comparison: it never executes candidates and never
  activates anything. Its output is a recommendation for HUMAN review.
- Inputs are three JSON files matching the `v1/optimization/*` schemas
  (check with `/afs-schema` first if unsure):

  `"${AFS_BIN:-${AFS_CLI:-afs}}" optimize decide --baseline <b.json> --candidate <c.json> --policy <p.json> --json`

- Exit codes are the contract; report them precisely:
  - `0` eligible_for_human_review — evidence verdict, still needs human approval
  - `1` rejected — evidence verdict
  - `2` invalid input or schema mismatch — fix the input, re-run
  - `3` inconclusive — evidence verdict; gather more samples or fix provenance
  - `4` internal gate error — NOT an evidence verdict; treat like `2`
    (fix and re-run), never like `rejected`
- Policy contract: objectives must declare `min_delta > 0`; guardrails must
  not declare `min_delta` at all.
- Never present exit `0` as approval to promote or activate; promotion always
  requires explicit human sign-off outside this gate.
- `--json` output is canonical and byte-stable for identical semantic inputs;
  `decision_sha256` can be quoted as the evidence fingerprint.

Return: the decision, reason codes, per-metric status, and the exact exit
code meaning for anything nonzero.
