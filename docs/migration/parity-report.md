# Parity Report — Cutover Rehearsal (local)

**Fecha:** 2026-08-22 · **Rama:** `feat/stack-migration-tanstack-nestjs`

## Resultado

Ensayo general del cutover ejecutado localmente con datos reales:

| Prueba | Resultado |
|---|---|
| Django legacy sobre Postgres efímero + seed representativo | ✅ |
| Suite Playwright contra stack LEGACY (referencia) | 6 passed / 0 failed / 11 skipped (gated) |
| ETL real Django → Prisma (--fresh) | 6/6 steps ✓ |
| Verificación de conteos (8 tablas core) | ✓ source == target |
| Login usuario migrado (hash `bcrypt_sha256` de Django) contra API nueva | ✅ 200 |
| API key emitida por Django (`bb_studio_…`) contra `/api/v1/me` nuevo | ✅ 200 + permisos correctos |
| Suite Playwright contra stack NUEVO | 10 passed / 0 failed / 7 skipped |

## Hallazgos durante el rehearsal

1. **~~BUG LEGACY (preexistente) — CORREGIDO~~:** login con password incorrecto en
   Django no mostraba feedback (los non-field errors de allauth nunca se renderizaban).
   Fix en rama `chore/e2e-parity-testids` del repo legacy (render de non_field_errors +
   data-testid compartidos). Verificado por Playwright: wrong-password muestra error
   en AMBOS stacks.
2. **Django usa BCryptSHA256PasswordHasher** que hashea el **hexdigest** sha256
   antes de bcrypt (no base64). Implementado y testeado en
   `password.crypto.ts` (`bcrypt_sha256$` prefix detection).
3. **Nombres de tabla Django**: snake_case con underscores dobles reales
   (`members_org_membership`, `social_accounts_social_account`,
   `composer_platform_post`, `api_keys_api_key`) — corregidos en el ETL.
4. **issue_api_key exige ≥1 cuenta allowlisted** y usuario emisor con permisos;
   el seeder debe resolver owner vía OrgMembership.

## Cómo reproducir

```bash
# 0. Infra
docker start bb-e2e-pg   # postgres:16 en :5433 (DBs: brightbean_django, brightbean_e2e)

# 1. Legacy + seed
cd /path/to/2post  # checkout main o worktree original
DATABASE_URL=postgres://postgres:e2e@localhost:5433/brightbean_django \
SECRET_KEY=test-secret-key-migration-fixture ENCRYPTION_KEY_SALT=test-salt-migration-fixture \
.venv/bin/python manage.py migrate && .venv/bin/python manage.py runserver 8000
# seed script: ver /tmp/e2e_seed.py (usuarios, org/ws, canal devto, post scheduled,
# inbox message, API key con allowlist)

# 2. Nuevo stack + seed equivalente (signup por API)
pnpm --filter @brightbean/api build
DATABASE_URL=postgres://postgres:e2e@localhost:5433/brightbean_e2e pnpm --filter api start:prod

# 3. Suites
E2E_BASE_URL=http://localhost:8000 E2E_STACK=legacy … npx playwright test auth.spec.ts app-shell.spec.ts public-surfaces.spec.ts
E2E_BASE_URL=http://localhost:3100 E2E_STACK=new    … npx playwright test auth.spec.ts app-shell.spec.ts public-surfaces.spec.ts

# 4. ETL real + verify
DATABASE_URL=<django-db> TARGET_DATABASE_URL=<prisma-db> pnpm --filter @brightbean/etl start -- --fresh
```

## Pendiente para cutover real

- [ ] Ampliar steps ETL: inbox, media (solo filas), notifications, portal tokens, oauth_server grants, audit_log
- [ ] Drain de django-background-tasks antes del snapshot (07-cutover-plan §3)
- [ ] Snapshot de producción → ETL → suite Playwright completa contra staging migrado
- [ ] Screenshots de paridad visual (3 anchos) por pantalla
