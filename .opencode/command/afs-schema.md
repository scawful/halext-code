---
description: list, show, or validate AFS structured-response schemas
---

Work with AFS structured-response schemas.

Request: `$ARGUMENTS`

Rules:

- List available schema names:

  `"${AFS_CLI:-afs}" schema list`

- Print one schema before authoring a payload that must match it:

  `"${AFS_CLI:-afs}" schema show <name>`

- Validate a structured payload (exit 1 on mismatch; `--json` includes a
  suggested correction):

  `"${AFS_CLI:-afs}" schema validate --schema <name> --file <path> --json`

- `implementation-plan` has an optional human-authored `human_intent` trust
  boundary. Agents must never create, fill, paraphrase, or edit that section.
  If no human skeleton was supplied, omit `human_intent`. If the human supplied
  an original skeleton file, preserve it and validate the expanded plan against
  that original:

  `"${AFS_CLI:-afs}" schema validate --schema implementation-plan --file <plan.json> --skeleton <human-plan.json> --json`

  Ordinary validation checks only the JSON shape; it does not prove that
  `human_intent` was preserved.

- Preferred schema per flow in this workspace:
  - plans: `implementation-plan`
  - review output: `review-findings`
  - verification output: `verification-summary`
  - handoffs: `handoff-summary`
  - optimization evidence: `v1/optimization/evaluation`, `v1/optimization/policy`
- Validate before handing a structured payload to another agent or gate;
  do not hand off a payload that failed validation.

Return: the schema names or validation verdict, plus the corrected shape if
validation failed.
