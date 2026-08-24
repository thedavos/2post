# Backend: NestJS + Fastify

## 1. Bootstrap

- `NestFactory.create(AppModule, new FastifyAdapter({ trustProxy: true }))`.
- `@fastify/cookie` + `@fastify/multipart` (media uploads), `@fastify/helmet` for security headers.
- Global prefix: none at the app level — routes are declared to match current paths (`/api/v1`, `/webhooks`, `/oauth`, etc.) so Caddy can route by prefix and external contracts stay stable.
- Validation: `nestjs-zod` global pipe; DTOs import zod schemas from `packages/shared`.
- OpenAPI: `@anatine/zod-openapi` or `@fastify/swagger` fed from zod schemas → serves docs (parity with today's `/api/v1/docs`).
- Errors: RFC-style problem+json filter; error taxonomy mirrors current API responses so agent clients don't break.
- Observability: Sentry (`@sentry/nestjs`), request logging via fastify built-in + pino.

## 2. Module map (Django app → NestJS module)

| Django app | NestJS module | Contents |
|---|---|---|
| accounts | `AuthModule` | email/password login, Google OAuth callback, sessions→JWT issuance, health check |
| organizations | `OrganizationsModule` | CRUD, deletion grace period, org settings |
| workspaces | `WorkspacesModule` | CRUD, whitelabel branding |
| members | `MembersModule` | RBAC roles/permissions, invitations, role hierarchy checks |
| settings_manager | `SettingsModule` | cascading defaults resolution (org → workspace) |
| credentials | `CredentialsModule` | platform credential storage (encrypted), admin-only surface |
| social_accounts | `SocialAccountsModule` | OAuth connect flows per platform, callbacks, reconnect, disconnect |
| composer | `ComposerModule` | posts, versions, templates, categories/tags, idea board |
| calendar | `CalendarModule` | slots, queues, scheduling endpoints |
| publisher | `PublisherModule` | publish orchestration, retries, rate-limit tracking, audit log |
| approvals | `ApprovalsModule` | stages, comments (internal/client), reminders |
| inbox | `InboxModule` + `WebhooksModule` | unified inbox; inbound webhook receivers with exact signature verification |
| analytics | `AnalyticsModule` | post/channel metrics, KPI aggregation |
| media_library | `MediaModule` | folders, assets, variants, S3/local storage abstraction, upload pipeline |
| notifications | `NotificationsModule` | preferences, in-app/email/outbound-webhook delivery |
| client_portal | `ClientPortalModule` | magic-link issue/redeem, portal approve/reject |
| api_keys | `ApiKeysModule` | key lifecycle + scoped bearer auth for `/api/v1` |
| oauth_server | `OAuthServerModule` | OAuth 2.1 authorization server (authorize/token/register/discovery) backing MCP |
| mcp | `McpModule` | JSON-RPC 2.0 Streamable HTTP endpoint, tool registry |
| intelligence | `IntelligenceModule` | gated by env flag exactly as today |
| common (encrypted fields, scoped managers) | `CryptoModule`, `TenantModule` | AES-256-GCM service; tenancy guard |

Controller organization inside each module mirrors the current URL structure. Example: `SocialAccountsController` owns `POST /social-accounts/connect/:platform`, `GET /social-accounts/callback/:platform` — byte-identical to today because these URLs are registered at each social platform's dev console.

## 3. Tenant scoping (replaces Django scoped managers)

- `TenantGuard` runs after auth; it resolves `{ userId, organizationId?, workspaceId? }` and attaches a Prisma client extension that auto-filters every query by the resolved scope — equivalent behavior to the current custom ORM manager.
- Workspace-level endpoints additionally verify membership + role via `MembersService.assertAccess(userId, workspaceId, permission)`.
- Defense-in-depth stays available via Postgres RLS later.

## 4. Background jobs (pg-boss)

Worker process boots pg-boss on the same PostgreSQL database. Job schedule mirrors today's registrations (from `apps/background_task_config.py`):

| Job | Frequency | Source parity |
|---|---|---|
| Publish scheduled posts | every 15 s | publisher |
| Sync inbox messages | every 5 min / account | inbox (+ backfill command ported as CLI script) |
| Collect post analytics | hourly (<48h old), daily (older) | analytics |
| Collect account metrics | daily | analytics |
| Collect audience demographics | weekly | analytics |
| Refresh OAuth tokens expiring <24h | hourly | social_accounts |
| Generate recurring posts (90-day lookahead) | daily | calendar |
| Generate scheduled reports | per config | reports |
| Process media for imminent posts | ≤60 min before publish | media_library |
| Send notifications | event-triggered queue | notifications |
| Health check accounts | every 6 h | social_accounts |
| Cleanup expired data | daily | various |
| Renew YouTube PubSubHubbub subscriptions | ~10-day expiry | webhooks |

Conventions:

- One file per processor under `modules/<domain>/jobs/`; registration in the module's `onApplicationBootstrap`.
- Jobs are idempotent and carry retry/backoff policies equal to current django-background-tasks settings.
- FFmpeg/Pillow equivalents: `ffmpeg` via child process (same limits: max 2 concurrent transcodes, 5-min timeout) and `sharp` for images.
- Before ETL/cutover, pending jobs are drained on Django side (see 07).

## 5. Social providers port

`providers/*.py` (base class `SocialProvider` + 14 modules incl. meta_insights, instagram_login variants) ports to TypeScript classes implementing the same interface:

```ts
// packages/shared/src/provider-types.ts (interface)
export interface SocialProvider {
  getAuthUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refreshToken(refreshToken: string): Promise<OAuthTokens>;
  getProfile(accessToken: string): Promise<AccountProfile>;
  publishPost(accessToken: string, content: PostContent): Promise<PublishResult>;
  // … same method set as providers/base.py
}
```

- Registry pattern identical to Python: register in a map keyed by platform slug; adding a platform touches one file + enum only.
- HTTP calls use `undici`/fetch (httpx equivalent); port request shapes **exactly** — these are live integrations verified against real APIs. Port tests too (`tests/test_oauth_aliases.py` etc. become vitest suites).
- Token/session refresh quirks (e.g., Bluesky refresh-before-publish fix #120) must be preserved — grep commit history when porting a provider.

## 6. Rate limiting & idempotency

- API-key rate limits (120/min writes, 300/min reads, 1000/min workspace aggregate, `Retry-After` + `X-RateLimit-*` headers): implement with a small Postgres-backed counter (pg-boss-compatible window table) or `@fastify/rate-limit` with Redis-free storage; headers must match exactly.
- Idempotency-Key handling: dedicated interceptor + `IdempotencyRecord` table mirroring current behavior.
