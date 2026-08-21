# AGENTS.md

Guidance for AI coding agents working in this repository.

## Repository state: mid-migration

This repo is migrating from **Django 5 + HTMX/Alpine + Tailwind** to **TanStack Start + React / NestJS + Fastify / StyleX**. Read `docs/migration/00-overview.md` first. The Django app is the **live product** — never break it. New-stack code lives under `apps/web`, `apps/api`, `apps/worker`, `packages/shared`.

- Work on the current product's features → edit the Django code (`apps/`, `providers/`, `templates/`).
- Work on the migration → edit the new workspaces and follow the docs in `docs/migration/`.
- Never mix both concerns in one commit.
- Migration branch: `feat/stack-migration-tanstack-nestjs` (worktree `../2post-migration`). Rebase onto `main` weekly.

## Commands

### Legacy (Django) — keep green at all times
```bash
pytest                                   # tests
ruff check . && ruff format --check .    # lint
mypy apps/ config/ --ignore-missing-imports
```

### New stack (pnpm workspaces)
```bash
pnpm install
pnpm dev                                 # web :3000, api :4000, worker
pnpm -w lint                             # eslint all workspaces
pnpm -w typecheck                        # tsc --noEmit all workspaces
pnpm --filter api test                   # vitest unit
pnpm --filter api test:e2e               # supertest
pnpm e2e                                 # playwright parity suite
pnpm --filter api prisma migrate dev     # db migrations
pnpm --filter api prisma studio
tsx tools/etl/run.ts --dry-run           # data migration tooling
```

Before finishing any task run: lint, typecheck, and the relevant test suite. Do not claim done if they fail.

## Architecture rules (new stack)

1. **All business logic in the API** (`apps/api`). The web app only fetches/mutates via the API client (`apps/web/src/lib/api.ts`) — no direct DB access from the frontend, ever.
2. **Shared types live in `packages/shared`**: zod schemas are the single source of truth; Nest DTOs and frontend form resolvers derive from them. Don't duplicate types.
3. **Tenant scoping is mandatory**: every Prisma query on tenant-scoped models goes through the tenant client extension/guard (`apps/api/src/common/tenant`). A query without org/workspace scope is a security bug.
4. **External contracts are frozen**: `/api/v1/*` payloads, webhook paths + signature verification, OAuth redirect URIs (`/social-accounts/callback/{platform}/`), MCP JSON-RPC, discovery documents. Changing these requires explicit human approval.
5. **Providers**: one class per platform implementing `SocialProvider` (`packages/shared/src/provider-types.ts`), registered in the provider registry. Port request shapes exactly from `providers/*.py`; check git history of each file for bugfix quirks before porting.
6. **Jobs**: pg-boss processors in `modules/<domain>/jobs/`, idempotent, intervals per `docs/migration/03-backend-nestjs.md` §4.
7. **Crypto**: encryption-at-rest must round-trip with the legacy Python implementation (HKDF-SHA256 + AES-256-GCM, see `docs/migration/06-auth-security.md` §2). Never "simplify" it.

## Frontend rules (TanStack Start + React)

- File-based routes mirror current URL structure (`docs/migration/04-frontend-tanstack.md` §2). Keep paths identical — bookmarks and platform registrations depend on them.
- Server state = TanStack Query. Query keys from `packages/shared/src/query-keys.ts`. Optimistic updates must roll back on error.
- Forms: react-hook-form + zod resolver from shared schemas.
- No other CSS system allowed. See StyleX rules below.

## StyleX rules (CSS)

- Styles via `stylex.create` co-located in the component file; applied with `stylex.props(...)` (last-wins composition).
- camelCase properties; longhand over multi-value shorthands; numbers are px; conditions inside values with required `default` key.
- Colors/spacing/radii only through tokens from `src/styles/tokens.stylex.ts` (`stylex.defineVars`) — no raw hex in components.
- No descendant-selector patterns (`space-x`, `divide`, `group-hover`, `peer-*`): use `gap`, child borders, or lifted state.
- White-label theming via `createTheme` overrides, not runtime style injection.
- When converting Tailwind classes: resolve to computed CSS first, then reshape — don't pattern-match names. Flag anything that doesn't convert 1:1 instead of silently changing design.

## Legacy (Django) conventions

Follow existing patterns: ruff config in `pyproject.toml`, scoped model managers for tenancy, `EncryptedTextField` for secrets, provider registry in `providers/`. Don't refactor legacy code beyond what a task needs — it's frozen after cutover.

## Testing expectations

- Ported Python tests become vitest suites with equivalent assertions (RBAC hierarchy, oauth aliases, analytics derivation, webhook signature verification).
- Every new API endpoint: unit test + supertest e2e incl. auth-negative case (no cookie / wrong org → 401/403).
- E2E parity suite (Playwright) must pass against staging before cutover items get checked off in `docs/migration/07-cutover-plan.md`.

## Commits & PRs

- Conventional commits (`feat(scope): …`), scopes like `web`, `api`, `worker`, `etl`, `legacy`.
- PRs touching external contracts need a human review even if CI is green.
