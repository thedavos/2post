# Stack Migration Overview

**Status:** Planning → Execution
**Branch:** `feat/stack-migration-tanstack-nestjs`
**Worktree:** `../2post-migration`
**Golden rule:** the product must remain fully functional at every point in time. Current users never notice the migration until cutover day, and cutover is a single, reversible switch.

---

## 1. Why

The current stack (Django 5 + server-rendered templates + HTMX + Alpine.js) has reached its ceiling for interactivity-heavy features (composer live preview, calendar drag-and-drop, inbox real-time). The target stack gives us:

- A typed end-to-end data layer (TypeScript everywhere, shared types between client and API).
- A real SPA-grade frontend (TanStack Start: SSR + file-based routing + type-safe search params).
- Atomic CSS with type safety and zero runtime cost (StyleX), replacing Tailwind utility strings.
- A structured backend with first-class DI, guards, interceptors, OpenAPI generation (NestJS).

## 2. Current stack (source of truth for parity)

| Layer | Technology |
|---|---|
| Backend | Django 5.1, django-ninja (REST API `/api/v1/`), django-oauth-toolkit (OAuth 2.1 server) |
| Frontend | Django templates, HTMX, Alpine.js (~24 Django apps, ~70k LOC Python) |
| CSS | Tailwind CSS 4 via django-tailwind (`theme/static_src`) |
| Database | PostgreSQL 16+ (data store **and** job queue via django-background-tasks) |
| Auth | django-allauth (email/password + Google OAuth), DB sessions, magic links (client portal) |
| Background jobs | django-background-tasks (PostgreSQL-backed) |
| Media | Local FS or S3-compatible (django-storages), Pillow + FFmpeg pipeline |
| API surface | Agent REST API + MCP server (JSON-RPC over Streamable HTTP) + inbound webhooks (Meta, YouTube PubSubHubbub) |
| Deployment | Docker Compose (app/worker/postgres/Caddy), Heroku, Railway, Render |

## 3. Target stack

| Layer | Technology |
|---|---|
| Frontend | TanStack Start + React 19 (SSR, file-based routes, TanStack Query + Router) |
| CSS | StyleX (`@stylexjs/stylex`), design tokens via `stylex.defineVars` |
| Backend | NestJS 11 + Fastify adapter — pure JSON API consumed by the frontend |
| ORM | Prisma (new schema designed for the domain; one-shot ETL from Django schema) |
| Jobs | pg-boss (PostgreSQL-backed queue, same philosophy as today: no Redis required) |
| Auth | JWT access + refresh tokens in httpOnly cookies issued by NestJS; Google OAuth + email/password preserved; magic links preserved for client portal |
| Shared | `packages/shared` — zod schemas + TS types shared by web and api |
| Deployment | Docker Compose (web/api/worker/postgres/Caddy), Railway/Render/Heroku equivalents updated |

## 4. Strategy: parallel build + single cutover

1. **Phase 0 — Foundations** (this branch): monorepo scaffold, CI, Prisma schema, docs. **Status: done** — workspaces bootable (`apps/web`, `apps/api`, `apps/worker`), Prisma baseline (identity + tenancy), StyleX pipeline verified, CI workflow `ci-new-stack.yml`.
2. **Phase 1 — Backend core**: NestJS modules mirroring Django apps; auth; orgs/workspaces/members RBAC. Parity-tested against a snapshot of production data restored into a staging DB. **Status: done** — AuthModule (bcrypt login + JWT httpOnly cookies + rotating 30-day sessions), Organizations/Workspaces/Members modules, RBAC hierarchy ported and tested against `test_role_hierarchy.py` expectations, CryptoService byte-compatible with legacy encryption (verified with Python-generated fixture).
3. **Phase 2 — Domain services**: composer, calendar/scheduling, publisher, approvals, social accounts/OAuth, media library, inbox, analytics, notifications, client portal, MCP/API-keys/oauth-server.
4. **Phase 3 — Frontend**: route-by-route rebuild in TanStack Start consuming only NestJS endpoints, styled with StyleX following the token system ported from `tailwind.config.js`.
5. **Phase 4 — Data migration**: one-shot ETL script (Django schema → Prisma schema), idempotent, dry-run mode, verified row-by-row against staging.
6. **Phase 5 — Cutover**: freeze Django writes → run ETL → smoke tests → flip reverse proxy to new stack → keep Django warm for ≤ 30 days as rollback.

During phases 0–4, `main` keeps shipping features on Django. The worktree rebases on `main` weekly; every parity feature lands behind no user-visible change until Phase 5.

## 5. Document index

| Doc | Contents |
|---|---|
| [01-architecture.md](01-architecture.md) | Monorepo layout, module boundaries, dev workflow, deployment changes |
| [02-database.md](02-database.md) | Prisma schema strategy, Django→Prisma table map, ETL plan |
| [03-backend-nestjs.md](03-backend-nestjs.md) | NestJS module map (Django app ↔ NestJS module), jobs, providers port |
| [04-frontend-tanstack.md](04-frontend-tanstack.md) | Route map (Django URL ↔ TanStack route), data fetching, HTMX→React patterns |
| [05-stylex.md](05-stylex.md) | StyleX setup, token system, conversion rules from Tailwind |
| [06-auth-security.md](06-auth-security.md) | JWT cookie auth, Google OAuth, encryption-at-rest, RBAC, rate limiting |
| [07-cutover-plan.md](07-cutover-plan.md) | Feature-parity checklist, ETL runbook, cutover & rollback runbook |

## 6. Non-goals

- No redesign. UI parity is the goal; visual output should match the current product.
- No feature additions during migration (features land on Django `main` and are ported if small, or deferred if large).
- No Redis introduction (pg-boss keeps PostgreSQL as the only infra dependency besides storage).
- The public REST/MCP API contract (`/api/v1/*`) stays byte-compatible where possible so existing agent integrations don't break.
