# Target Architecture

## 1. Monorepo layout (pnpm workspaces)

```
2post/
├── apps/
│   ├── web/                      # TanStack Start + React (SSR)
│   │   ├── src/
│   │   │   ├── routes/           # File-based routes (see 04-frontend-tanstack.md)
│   │   │   ├── components/       # UI components, StyleX styles co-located
│   │   │   ├── lib/              # api client, auth helpers, query client
│   │   │   ├── styles/           # .stylex.ts token files (tokens.stylex.ts)
│   │   │   └── server.ts         # SSR entry
│   │   ├── vite.config.ts        # @stylexjs/vite-plugin + TanStack Start plugin
│   │   └── package.json
│   ├── api/                      # NestJS + Fastify
│   │   ├── src/
│   │   │   ├── modules/          # One module per domain (see 03)
│   │   │   ├── common/           # guards, interceptors, filters, decorators
│   │   │   ├── prisma/           # PrismaService + migrations
│   │   │   └── main.ts           # Fastify adapter bootstrap
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── package.json
│   └── worker/                   # pg-boss worker process (same codebase as api,
│       │                         # separate entrypoint: src/worker/main.ts)
│       └── package.json
├── packages/
│   └── shared/                   # zod schemas, TS types, constants shared web↔api
├── legacy/                       # (frozen at cutover) current Django project root content
├── docs/migration/               # This documentation
├── pnpm-workspace.yaml
├── package.json                  # scripts: dev, build, test, lint, typecheck
├── turbo.json                    # optional task orchestration
└── .github/workflows/ci.yml     # lint+typecheck+test for all workspaces
```

Notes:

- The Django codebase **stays in the repo untouched** during phases 0–4 (it is the running product). At cutover it moves to `legacy/` and is deleted after the 30-day rollback window.
- `apps/worker` is a thin package that reuses `apps/api`'s job processors; pg-boss runs inside a dedicated process (`node dist/apps/worker/main.js`) mirroring today's `python manage.py process_tasks` dyno.

## 2. Runtime topology

**Development**

| Process | Command | Port |
|---|---|---|
| Web (TanStack Start) | `pnpm --filter web dev` | 3000 |
| API (NestJS Fastify) | `pnpm --filter api start:dev` | 4000 |
| Worker (pg-boss) | `pnpm --filter worker start:dev` | — |
| PostgreSQL 16 | docker compose | 5432 |

The web dev server proxies `/api/*` to `localhost:4000` so cookies work same-origin.

**Production**

- `web`: Node server (Nitro) behind Caddy, or static prerender where possible.
- `api`: Fastify on internal port; Caddy routes `/api/v1`, `/webhooks`, `/oauth`, `/.well-known` to it, everything else to `web`.
- `worker`: pg-boss process.
- Same deploy targets as today (Docker Compose VPS / Railway / Render / Heroku), with updated Dockerfiles per workspace and a compose file that starts all four services.

## 3. Request flow

```
Browser → Caddy → [ TanStack Start SSR ] → HTML + hydrated React app
                     │ (server fns / loaders call API directly or browser calls API)
                     ▼
Browser JS → fetch('/api/v1/...', { credentials: 'include' }) → NestJS/Fastify
                     │ JWT verified from httpOnly cookie (guard)
                     ▼
                Prisma → PostgreSQL
                     ▲
pg-boss jobs (publish, inbox sync, analytics, token refresh…) ← enqueued by API modules
```

Rules:

- **All business logic lives in the API.** The frontend never touches Prisma directly. TanStack server functions may call internal service clients, but they still go through the API's HTTP surface or an internal typed client — no duplicated logic.
- **Cookies are first-party**: web and api are served under one domain, different path scopes handled by Caddy, so no CORS/cookie headaches.
- **Real-time**: keep 30s polling initially (TanStack Query `refetchInterval`); upgrade path is SSE from Fastify later.

## 4. Tooling standards

| Concern | Choice |
|---|---|
| Language | TypeScript strict everywhere |
| Package manager | pnpm ≥ 10 |
| Validation | zod (shared schemas); Nest DTOs generated from/aligned with them via `nestjs-zod` |
| Lint/format | ESLint (flat config) + Prettier |
| Testing | Vitest (unit), supertest against Fastify (API e2e), Playwright (E2E parity suite) |
| Typecheck | `tsc --noEmit` per workspace, wired into CI |
| Env vars | zod-parsed env modules (`packages/shared/src/env.ts`), fail-fast on boot |

## 5. Compatibility surfaces that must not change

These are consumed by external parties; preserve exact paths/payloads:

1. `GET /health/` → keep path working (Caddy rewrite to new health endpoint).
2. Agent REST API `/api/v1/*` contract incl. `Authorization: Bearer bb_studio_*` keys, rate-limit headers, idempotency keys.
3. MCP endpoint `POST /api/v1/mcp` (JSON-RPC 2.0 over Streamable HTTP) and OAuth 2.1 server endpoints (`/oauth/authorize`, `/oauth/token`, `/oauth/register`, discovery documents).
4. Inbound webhooks `POST /webhooks/facebook/`, `POST /webhooks/youtube/`, `POST /webhooks/instagram_login/` (signature verification must be ported exactly).
5. OAuth redirect URI pattern `{APP_URL}/social-accounts/callback/{platform}/` — registered at Meta/LinkedIn/TikTok/Google/Pinterest; changing it would break every connected account. Keep these paths byte-identical.
6. Client portal magic-link URLs.
