# Cutover Plan & Parity Checklist

## 1. Feature parity checklist (gate for cutover)

Every item = implemented in new stack + E2E test green + visual parity sign-off.

**Auth & accounts**
- [ ] Email/password login, signup, password reset
- [ ] Google SSO
- [ ] Sessions: 30-day sliding, logout everywhere, org switcher

**Orgs / workspaces / members**
- [ ] Org CRUD + 14-day reversible deletion grace period
- [ ] Workspace CRUD + whitelabel branding
- [ ] Members, invitations, custom roles, role hierarchy, Client role
- [ ] Settings cascade (org → workspace defaults)

**Content pipeline**
- [ ] Composer: rich editor, per-platform overrides, version history, templates, categories/tags, idea Kanban board, Unsplash search
- [ ] Calendar: month/week/day views, recurring weekly slots, named queues auto-assign, drag-and-drop rescheduling with optimistic UI
- [ ] Approvals: none/optional/internal/internal+client stages, threaded internal+client comments, reminders, audit trail, on_hold state
- [ ] Publisher: scheduled publishing every 15 s, retries, per-account rate-limit tracking, 90-day audit log, single-video-as-Reel IG behavior, Threads container wait

**Connections**
- [ ] OAuth connect/disconnect/reconnect for all platforms: facebook, instagram, instagram_login, linkedin_personal, linkedin_company, tiktok (`social1` slug), youtube, google_business, pinterest, threads, bluesky (app password), mastodon (auto app registration), devto (API key)
- [ ] Token refresh job (<24h expiry), Bluesky pre-publish refresh
- [ ] Inbound webhooks: Meta signature verify, YouTube PubSubHubbub challenge+renewal, Instagram Login verify token

**Inbox**
- [ ] Unified inbox across supported platforms, sentiment tagging, assignments, threaded replies, historical backfill command, dedup via platformMessageId

**Analytics**
- [ ] Per-post metrics incl. per-platform breakdowns; channel KPI cards; 7/30/90-day trends; sortable all-posts table (views, engagement, follower growth, reach, watch time); Facebook analytics sync parity (#114)

**Media library**
- [ ] Org/workspace-scoped libraries, nested folders, platform-optimized variants, alt text, upload pipeline (sharp images / FFmpeg video, 2-concurrent-transcode limit)

**Client portal**
- [ ] Magic-link issue/redeem (30-day), approve/reject flow, publish tab

**Notifications**
- [ ] In-app badge (30 s poll), email, outbound webhooks, per-user preferences per event type

**Platform/API surface**
- [ ] `/api/v1/*` REST contract byte-compatible (incl. rate-limit headers, idempotency keys)
- [ ] MCP endpoint + tool set unchanged; OAuth 2.1 server + DCR + discovery docs working with Claude Desktop
- [ ] API keys UI + scoped bearer auth working with migrated keys
- [ ] `GET /health/` responds

**Ops**
- [ ] Docker Compose dev + prod files updated (web/api/worker/postgres/caddy)
- [ ] Railway template/render.yaml/Procfile/app.json equivalents updated
- [ ] CI green: lint, typecheck, unit, e2e
- [ ] Backup command ported (`pg_dump` + manifest)

## 2. Pre-cutover dry runs (staging)

1. Restore a fresh production snapshot into staging Django DB.
2. Run ETL `--dry-run` → review report.
3. Run ETL for real → run verification report → fix discrepancies.
4. Boot new stack against migrated staging DB; run full E2E suite + manual smoke of the checklist above.
5. Repeat until two consecutive clean runs.

## 3. Cutover runbook (production)

```
T-24h   Announce maintenance window. Verify backups (DB + media manifest).
T-0     Maintenance mode ON (Caddy serves static notice).
        1. Stop Django app + worker. Drain pending django-background-tasks jobs
           (run worker until queue empty; record count).
        2. Final DB snapshot.
        3. Run ETL against production (resume-capable). Verification report must pass 100%.
        4. Apply Prisma migrations if any pending.
        5. Start new stack: api → worker → web. Health checks green.
        6. Smoke tests: login, connect-account page loads, calendar renders,
           API key auth works, webhook endpoints return correct errors,
           MCP initialize handshake OK.
        7. Flip Caddy routing to new stack (keep old config commented).
        8. Maintenance mode OFF. Monitor Sentry + logs closely for 48h.
Rollback: flip Caddy back to Django, restore snapshot only if ETL wrote
          post-snapshot data (it shouldn't — Django is frozen). RPO ≈ 0.
```

## 4. Post-cutover

- Keep Django code in `legacy/` and a cold backup for 30 days, then delete.
- Watch: publish jobs completing on schedule, inbox sync lag, token refresh failures, webhook 2xx rates, analytics collection.
- Decommission plan for leftover infra: none required (same Postgres instance can host both schemas during transition; drop Django schema after the window).

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Encryption round-trip mismatch breaks stored tokens | Cross-language crypto tests before any ETL (06 §2) |
| Provider port regressions (live APIs) | Port provider tests verbatim; sandbox credentials for each platform |
| Job timing drift (pg-boss vs background-tasks) | Interval table asserted in integration tests; monitor publish latency post-cutover |
| Missed HTMX micro-interaction | Checklist walkthrough per screen by a human before sign-off |
| External agent clients break | Contract tests generated from current OpenAPI spec replayed against new API |
| Long migration, main keeps moving | Weekly rebase of worktree onto main; parity checklist re-run on changed features |
