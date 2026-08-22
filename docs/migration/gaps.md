# Gap Backlog — pre-cutover

Fuente: inventario honesto post-rehearsal. Marcar ✅ al cerrar cada ítem con su PR.

## 🔴 Bloqueante para cutover

**Backend**
- [x] 1. OAuth 2.1 server (`/oauth/authorize|token|register` + `.well-known`) — sin esto Claude Desktop/MCP-OAuth se rompe
- [ ] 2. Jobs pg-boss restantes: analytics sync, refresh tokens <24h, health check cuentas, posts recurrentes, media para publicaciones inminentes, cleanup diario
- [ ] 3. Pipeline de media: variantes por plataforma (sharp) + FFmpeg (límite 2 transcodes concurrentes)
- [ ] 4. Envío de email (SMTP/Resend): invitaciones, notificaciones, reset
- [ ] 5. Password reset completo (endpoints + emails)
- [ ] 6. Backfill de inbox (paridad `backfill_inbox`)
- [x] 7. Audit log interceptor (tabla existe, nadie escribe)
- [ ] 8. Rate limit en login/OAuth endpoints

**ETL**
- [ ] 9. Steps restantes: inbox_messages(+replies), media_assets, tags, ideas, notification_preferences, portal_access_tokens, **oauth_server apps/grants/tokens**, audit_log, publish_logs, metric_snapshots, rate_limit_states, queue_entries/slots, workspace settings/branding, credentials platform-level

## 🟡 UX visible

- [ ] 10. Members/invitaciones UI
- [ ] 11. Calendar avanzado: slots y colas UI, drag-and-drop real
- [ ] 12. Idea board Kanban + templates + categorías/tags UI
- [ ] 13. Previews por plataforma en composer
- [ ] 14. Thread de comentarios en approvals
- [ ] 15. Settings completos: whitelabel branding UI, preferencias notificación, org settings
- [ ] 16. Onboarding checklist wizard real

## 🟢 Infra/delivery

- [ ] 17. Dockerfiles nuevo stack + compose + Caddy + Railway/Render/Heroku
- [ ] 18. CI con servicio Postgres para e2e
- [ ] 19. Sentry + CSP/helmet
- [ ] 20. Screenshots paridad visual (3 anchos) + suite contra staging real

## ✅ Validado (no repetir)

Login migrado (bcrypt_sha256), API keys Django byte-compat, ETL core 6/6 verificado, publish cada 15s, webhooks HMAC, RBAC, composer/calendar/inbox/analytics/media/portal básicos, channels OAuth flows.
