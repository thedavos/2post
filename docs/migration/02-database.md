# Database: Prisma + Data Migration

## 1. Strategy

- **New Prisma schema designed from the domain**, not a mechanical copy of Django's generated tables (Django names tables `app_model`, uses implicit M2M join tables, integer/bigint PKs or UUIDs depending on app).
- **One-shot ETL** at cutover: read from Django PostgreSQL schema → transform → write into the new Prisma-managed schema. Idempotent (`--resume`), dry-run mode, row-count + checksum verification report.
- UUIDs as primary keys everywhere (the current code already uses UUIDs for most public identifiers).
- All timestamps `timestamptz`; keep Django's UTC convention.

## 2. Schema design rules

1. One Prisma model per domain entity; explicit `@@map` to snake_case table names.
2. M2M relations become **explicit join models** when they carry data (Django's `through` tables) — otherwise `implicitManyToManyRelation` with `@map` on the join table.
3. Multi-tenancy: every tenant-scoped model keeps `organizationId` (+ `workspaceId` where applicable) with a **composite index** `(organizationId, id)` / `(workspaceId, id)` — this replaces Django's scoped custom manager and becomes the basis of the tenant guard in NestJS (see 03 §Tenant scoping).
4. Encrypted-at-rest columns (OAuth tokens, credentials, API keys) are `String` in Prisma but always accessed through the crypto service — never raw. Add Prisma client extensions to enforce this.
5. Soft-delete / audit fields preserved where they exist today (`deleted_at`, grace-period org deletion, append-only audit log table).

## 3. Table map (Django → Prisma)

Inventory of source apps: accounts, organizations, workspaces, members, settings_manager, credentials, composer, approvals, calendar, publisher, social_accounts, inbox, analytics, media_library, notifications, client_portal, api_keys, oauth_server, intelligence, mcp.

| Django source | Target Prisma model(s) | Notes |
|---|---|---|
| `accounts.User` | `User` | Keep email uniqueness, bcrypt hashes are compatible with Node bcrypt libs |
| allauth `SocialAccount`/`SocialApp` records | `ExternalIdentity` | Google SSO only today |
| `organizations.Organization` (+ deletion grace) | `Organization` | keep `deletion_scheduled_at` semantics |
| `workspaces.Workspace` | `Workspace` | whitelabel branding columns move to `WorkspaceBranding` or stay inline |
| `members.Membership`, roles, invitations | `Membership`, `Role`, `Permission`, `Invitation` | RBAC: port role hierarchy exactly (custom roles supported) |
| `settings_manager.*` cascade defaults | `WorkspaceSetting` | cascade org→workspace resolution logic moves to service layer |
| `credentials.PlatformCredential` | `PlatformCredential` | AES-256-GCM ciphertext copied verbatim — **key derivation must match** (HKDF from `SECRET_KEY`) so decryption still works post-cutover |
| `composer.Post`, versions, templates, categories/tags, idea board | `Post`, `PostVersion`, `PostTemplate`, `Category`, `Tag`, `Idea` | per-platform overrides become JSON column typed with zod-validated shape |
| `calendar.*` slots & queues | `PostingSlot`, `Queue`, `QueueAssignment` | recurring weekly slot expansion stays in worker logic |
| `approvals.*` stages/comments | `ApprovalFlow`, `ApprovalStage`, `ApprovalComment` (internal vs external flag) | |
| `publisher.*` attempts/audit/rate-limit tracking | `PublishAttempt`, `PublishAuditLog` (90-day retention), `AccountRateLimitState` | |
| `social_accounts.SocialAccount`, tokens | `SocialAccount`, `SocialAccountToken` | tokens encrypted; platform account IDs must be preserved exactly (dedup keys for webhooks) |
| `inbox.*` messages/assignments/sentiment/backfill | `InboxMessage`, `InboxThread`, `InboxAssignment` | `platformMessageId` unique index preserved (webhook dedup) |
| `analytics.*` post/account metrics | `PostMetric`, `AccountMetricSnapshot`, `AudienceDemographic` | time-series; consider monthly partitioning later, not required at cutover |
| `media_library.*` folders/assets/variants | `MediaFolder`, `MediaAsset`, `MediaVariant` | storage keys copied verbatim so S3 objects don't move |
| `notifications.*` prefs/delivery/webhooks out | `NotificationPreference`, `NotificationDelivery`, `OutboundWebhook` | |
| `client_portal.*` magic links | `PortalAccess` | SHA-256-hashed tokens preserved |
| `api_keys.*` | `ApiKey` | hash format preserved (`bb_studio_…` SHA-256); scopes array column |
| django-background-tasks tables | dropped after cutover | pending jobs are drained before ETL (see 07) |
| `oauth_server.*` (django-oauth-toolkit) | `OAuthApplication`, `OAuthGrant`, `OAuthAccessToken`, `OAuthRefreshToken` | DCR-registered Claude Desktop clients must survive: migrate applications + active tokens |
| audit log | `AuditLog` | append-only; never rewritten by ETL |

## 4. ETL script

Location: `tools/etl/` (TypeScript, run with `pnpm tsx tools/etl/run.ts`).

Design:

```
Source: DATABASE_URL (Django DB, read-only)
Target: TARGET_DATABASE_URL (Prisma DB)
Steps (each resumable, checkpointed in etl_state table):
  01_users → 02_orgs_workspaces_members → 03_settings
  04_credentials (byte-copy ciphertext) → 05_social_accounts_tokens
  06_composer_content → 07_calendar_queues → 08_approvals
  09_publisher_history → 10_inbox → 11_analytics
  12_media_library (copy DB rows; S3 untouched) → 13_notifications
  14_api_keys_oauth_server → 15_audit_log
  16_verify  ← row counts + spot checksums vs source, writes verification report
```

Rules:

- Foreign-key order respected; single transaction per step.
- `--dry-run` reads source and reports what would change without writing.
- Verification compares row counts per table and sampled content hashes; any mismatch aborts cutover.
- Media files are **not** moved — S3 keys/local paths stored in rows are identical pre/post.
- Encrypted values are byte-copied; nothing is re-encrypted if the key derivation matches (it must — see 06).

## 5. Local development parity

For dev we do **not** require a Django DB: `prisma migrate reset && pnpm --filter api db:seed` seeds a realistic fixture set (orgs, workspaces, posts, connected mock accounts). The ETL path is only exercised against staging restores.
