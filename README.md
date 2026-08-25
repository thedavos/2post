<p align="center">
  <a href="https://github.com/thedavos/2post">
    <img src=".github/assets/2post-logo.webp" alt="2post" width="280">
  </a>
</p>

<p align="center">
  <strong>Open-source social media management for creators, agencies, and SMBs.</strong>
</p>

<p align="center">
  <a href="https://github.com/thedavos/2post/actions"><img src="https://img.shields.io/badge/tests-110%20passing-brightgreen" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript"></a>
  <a href="https://nestjs.com/"><img src="https://img.shields.io/badge/NestJS-Fastify-E0234E.svg" alt="NestJS"></a>
  <a href="https://tanstack.com/start"><img src="https://img.shields.io/badge/TanStack-Start-orange.svg" alt="TanStack Start"></a>
</p>

---

## About 2post

2post is an open-source, self-hostable social media management platform built for creators, agencies and SMBs. Plan, compose, schedule, approve, publish, and monitor content across Facebook, Instagram, LinkedIn, TikTok, YouTube, Pinterest, Threads, Bluesky, Google Business Profile, Mastodon, and DEV.to from a single multi-workspace dashboard.

It's for people managing many client accounts under one roof who'd rather own their social stack than pay $100–300/month to a SaaS vendor. Every feature is available to every user. No paid tier, no feature gate, no upsell.

## Features

| | |
|---|---|
| **Multi-workspace & teams** | Unlimited orgs → workspaces → members. Granular RBAC with custom roles, invitations, and a separate Client role for external collaborators. |
| **Content composer** | Rich editor with per-platform caption/media overrides, version history, reusable templates, content categories & tags, a Kanban idea board. |
| **Calendar & scheduling** | Visual calendar with recurring weekly posting slots per account and named queues that auto-assign posts to the next available slot. |
| **Publishing engine** | Direct first-party API integrations (no aggregator), automatic retries, per-account rate-limit tracking, and a 90-day publish audit log. |
| **Approval workflows** | Configurable stages (none / optional / internal / internal + client), threaded internal & external comments, reminders, and a full audit trail. |
| **Unified social inbox** | Comments, mentions, DMs, and reviews from every connected platform in one place, with sentiment analysis, assignments, threaded replies, and historical backfill. |
| **Analytics** | Per-post and channel-level performance from every connected platform's native API, with KPI cards, 7/30/90-day trend charts, and a sortable all-posts table for views, engagement, follower growth, reach, and watch time. |
| **Media library** | Org- and workspace-scoped libraries with nested folders, auto-generated platform-optimized variants (sharp + FFmpeg), alt text, and built-in Unsplash stock-photo search in the composer. |
| **Client portal** | Passwordless 30-day magic-link access so clients can approve or reject posts without creating an account. |
| **Notifications** | In-app, email, and webhook delivery with per-user preferences for every event type. |
| **Security & ops** | Encrypted token & credential storage (AES-256-GCM), Google SSO, Sentry support, OAuth 2.1 server for MCP clients, and a reversible org-deletion grace period. |
| **Agent API** | REST API (`/api/v1`) + MCP server (JSON-RPC 2.0) with scoped API keys, rate limiting, idempotency keys, and OAuth DCR — so AI agents can read analytics, manage media, and create or schedule posts. |
| **White-label friendly** | Per-workspace branding (logo, colors) via a 3-layer CSS token architecture. |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | TanStack Start + React 19 + StyleX |
| Backend | NestJS 11 + Fastify |
| ORM / Database | Prisma + PostgreSQL 16+ |
| Background jobs | pg-boss (PostgreSQL-backed, no Redis required) |
| Auth | JWT httpOnly cookies + Google SSO |
| Media processing | sharp (images) + FFmpeg (video) |
| Validation | zod schemas shared between frontend and backend |
| Testing | Vitest (unit/integration) + Playwright (e2e parity suite) |
| Deployment | Docker, Caddy reverse proxy |

## Project Structure

```
2post/
├── apps/
│   ├── web/            # TanStack Start frontend (SSR + SPA)
│   │   └── src/routes/ # File-based routing
│   ├── api/            # NestJS backend (Fastify adapter)
│   │   ├── src/modules/# Domain modules (auth, composer, inbox, …)
│   │   └── prisma/     # Schema + migrations
│   └── worker/         # pg-boss background jobs processor
├── packages/
│   └── shared/         # zod schemas, types, RBAC matrices shared by web + api
├── tools/
│   └── etl/            # Data migration from legacy systems
└── docs/migration/     # Migration documentation
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL 16+

### Setup

```bash
git clone https://github.com/thedavos/2post.git
cd 2post
pnpm install
cp apps/api/.env.example apps/api/.env

# Generate Prisma Client + run migrations
pnpm --filter @brightbean/api exec prisma migrate dev

# Seed dev data
pnpm db:seed

# Start everything
pnpm dev:web    # TanStack Start on :3000
pnpm dev:api    # NestJS on :4000
pnpm dev:worker # pg-boss worker
```

Open http://localhost:3000 and create an account.

## Running Tests

```bash
pnpm -r test          # unit + integration tests
pnpm lint             # eslint
pnpm typecheck        # tsc across all workspaces
```

With coverage:

```bash
pnpm --filter @brightbean/api exec vitest run --coverage
```

## Platform Credentials

To connect social media accounts, you need API credentials from each platform's developer portal. Set them via environment variables in `.env` (see `apps/api/.env.example`).

**Redirect URI:** When registering your app on any platform, set the OAuth redirect URI to:

```
{APP_URL}/social-accounts/callback/{platform}/
```

> **TikTok:** use the slug `social1` instead of `tiktok` — TikTok rejects redirect URIs containing their brand name.

See each platform's documentation in `apps/api/.env.example` for the specific environment variables needed.

## Agent API & MCP for AI Agents

2post ships a REST API and an MCP (Model Context Protocol) server so agents and scripts can read analytics, manage media, and create or schedule posts.

Issue an API key from **Organization → API Keys** in the app. Keys are workspace-scoped, can be allowlisted to specific social accounts, and inherit a subset of the issuer's workspace permissions.

```
Authorization: Bearer 2post_…
```

Claude Desktop and other MCP-native connectors can also authenticate via OAuth 2.1 with PKCE — point them at `{APP_URL}/api/v1/mcp` and discovery documents are served at `/.well-known/oauth-authorization-server`.

## Self-Hosting

### Docker Compose

```bash
cp apps/api/.env.example .env
docker compose up -d --build
```

This starts web (SSR), api (Fastify), worker (pg-boss), and PostgreSQL.

### Railway / Render / Heroku

Deployment configs are being updated for the new stack. The legacy configs in `docs/migration/` document the previous setup.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding guidelines, and how to submit pull requests.

## Security

To report a security vulnerability, see [SECURITY.md](SECURITY.md). Do not open a public issue.

## License

[AGPL-3.0](LICENSE) — see LICENSE for details.
