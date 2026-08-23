# Gap Backlog — pre-cutover

Fuente: inventario honesto post-rehearsal. Marcar ✅ al cerrar cada ítem con su PR.

## 🔴 Bloqueante para cutover

**Backend**
- [x] 1. OAuth 2.1 server (`/oauth/authorize|token|register` + `.well-known`) — sin esto Claude Desktop/MCP-OAuth se rompe
- [ ] 2. Jobs pg-boss restantes: analytics sync, refresh tokens <24h, health check cuentas, posts recurrentes, media para publicaciones inminentes, cleanup diario
- [x] 3. Pipeline de media: variantes por plataforma (sharp) + FFmpeg (límite 2 transcodes concurrentes)
- [x] 4. Envío de email (SMTP/Resend): invitaciones, notificaciones, reset
- [x] 5. Password reset completo (endpoints + emails)
- [x] 6. Backfill de inbox (paridad `backfill_inbox`)
- [x] 7. Audit log interceptor (tabla existe, nadie escribe)
- [x] 8. Rate limit en login/OAuth endpoints

**ETL**
- [x] 9. Steps core implementados (11 steps): users, orgs/ws/members, social_accounts, composer(posts/categories/platform_posts), api_keys, inbox, media_assets, tags, calendar(slots/queues/entries), publish_logs+rate_limit_states — verificación 14 tablas ✓
- [ ] 9b. Steps avanzados: ideas, notification prefs/deliveries, portal tokens, oauth2 grants/apps/tokens, audit_log, workspace settings

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
