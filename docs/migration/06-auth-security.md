# Auth & Security

## 1. Authentication (JWT in httpOnly cookies)

Issued by NestJS `AuthModule`, stored by the browser automatically:

| Token | Cookie name | Lifetime | Notes |
|---|---|---|---|
| Access | `bb_at` | 15 min | JWT HS256 (or RS256 if we later split services), claims: `sub` (userId), `orgId` (active org), `sid` |
| Refresh | `bb_rt` | 30 days, **rotated on every use** | DB-backed session row (`Session` model) so logout/revoke works everywhere — mirrors today's 30-day sliding DB sessions |

- Both cookies: `httpOnly; Secure; SameSite=Lax; path=/`.
- Sliding expiration: refresh rotation extends the session row, matching current behavior.
- Logout / org deletion / password change revokes the `Session` row server-side.
- Active-org switching: `POST /auth/switch-org/:orgId` re-issues access token with new claim.

Flows preserved:

1. Email + password (bcrypt hashes copied verbatim in ETL — Node `bcrypt` verifies cost-12 Django hashes fine).
2. Google SSO via OAuth callback on the API.
3. Client-portal magic links: 32-byte token, SHA-256 hash stored, 30-day validity — same token semantics, issued by API, redeemed through portal routes.
4. Password reset emails.

## 2. Encryption at rest — must be byte-compatible

Ported from `apps/common/encryption.py`. The Node implementation **must reproduce exactly**:

```
key    = HKDF-SHA256(ikm=SECRET_KEY, salt=ENCRYPTION_KEY_SALT, info="brightbean-field-encryption", length=32)
format = base64( nonce[12] || AES-256-GCM(key, nonce, plaintext) )
```

Node equivalent: `crypto.hkdfSync('sha256', secret, salt, 'brightbean-field-encryption', 32)` + `createCipheriv('aes-256-gcm')` with auth tag appended as Python's `cryptography` does (tag = last 16 bytes of ciphertext output). Add cross-compatibility tests: encrypt in Node → decrypt with the Python function against a fixture, and vice versa. If this doesn't round-trip, every stored OAuth token breaks at cutover.

Key rotation management command is ported too.

## 3. RBAC

- Role hierarchy and custom roles from `apps/members` port to `MembersModule`; permission keys stay identical strings (`create_posts`, `publish_directly`, `upload_media`, `view_analytics`, etc.) since they appear in API responses and docs.
- Decorator-based checks: `@RequirePermission('create_posts')` + workspace-scoped guard; role hierarchy resolution logic unit-tested 1:1 against Python test expectations (`test_role_hierarchy.py`, `test_org_permissions.py`).

## 4. API keys, MCP, OAuth server

- `bb_studio_*` API keys: format and SHA-256 hashing preserved so existing keys keep working after ETL copies the hashes. Scopes/allowlists identical.
- Rate-limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`) reproduced exactly.
- OAuth 2.1 authorization server (django-oauth-toolkit) → `OAuthServerModule`: `/oauth/authorize`, `/oauth/token`, `/oauth/register` (DCR), revoke, and both `.well-known` discovery documents. Claude Desktop's DCR-registered clients and active grants migrate in the ETL.
- MCP endpoint stays JSON-RPC 2.0 over Streamable HTTP at `POST /api/v1/mcp`; tool names/payloads unchanged.

## 5. Webhook signature verification (exact ports)

- Meta (Facebook/Instagram/Threads): HMAC-SHA256 over raw body vs `X-Hub-Signature-256`, constant-time compare. Raw-body access required — configure Fastify to read the exact buffer before JSON parsing for webhook routes only.
- YouTube PubSubHubbub: GET challenge echo + optional hub.secret HMAC.
- Instagram Login webhook verify-token handshake.

## 6. Platform hardening parity

| Today | Target |
|---|---|
| django-csp restrictive policy | `@fastify/helmet` CSP configured identically (web: TanStack Start headers) |
| django-ratelimit (login, API, OAuth endpoints) | `@fastify/rate-limit` per-route + Postgres store where needed |
| CSRF middleware | Not needed for cookie+SameSite=Lax + JSON APIs; enforce `Origin` check on mutating requests for defense-in-depth |
| Session cookie flags | Same flags on JWT cookies (§1) |
| Audit log (append-only, destructive actions) | Same table/semantics, written by interceptor on destructive mutations |
| Sentry | `@sentry/nestjs` + browser SDK |

## 7. Secrets & env

All env parsing centralized in `packages/shared/src/env.ts` with zod; boot fails fast on missing vars. Variable names keep today's names (`SECRET_KEY`, `ENCRYPTION_KEY_SALT`, `DATABASE_URL`, `PLATFORM_*`, …) so deployment configs and self-hosters' `.env` files survive cutover unchanged.
