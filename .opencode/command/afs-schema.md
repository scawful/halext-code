---
description: list, show, or validate AFS structured-response schemas
---

Work with AFS structured-response schemas.

Request: `$ARGUMENTS`

Rules:

- List available schema names:

  `~/src/lab/afs/scripts/afs schema list`

- Print one schema before authoring a payload that must match it:

  `~/src/lab/afs/scripts/afs schema show <name>`

- Validate a structured payload (exit 1 on mismatch; `--json` includes a
  suggested correction):

  `~/src/lab/afs/scripts/afs schema validate --schema <name> --file <path> --json`

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
