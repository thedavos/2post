# ETL: Django schema → Prisma schema

One-shot data migration tooling (runbook: `docs/migration/02-database.md` §4, cutover: `07-cutover-plan.md`).

Planned structure:

```
run.ts          # orchestrator, resumable steps checkpointed in etl_state
steps/01_users.ts … 16_verify.ts
```

Environment:

- `DATABASE_URL` — source (legacy Django DB, read-only access)
- `TARGET_DATABASE_URL` — target (Prisma DB)

Implemented in Phase 4. Nothing to run yet.
