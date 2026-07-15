# AGENTS.md — 2post

Open-source, self-hostable social media management for creators, agencies, and SMBs. Cloud and self-hosted share the same codebase. No feature gates, no aggregator middleman — first-party platform APIs only.

Hosted product: [2post.app](https://2post.app). Repo: [github.com/thedavos/2post](https://github.com/thedavos/2post).

## Stack

| Layer | Choice |
|-------|--------|
| Backend | Django 5.x, Django Ninja (public API) |
| Frontend | Django templates, HTMX, Alpine.js |
| CSS | Tailwind 4 via django-tailwind + CSS brand tokens (Ember) |
| DB / jobs | PostgreSQL 16+; `django-background-tasks` (no Celery/Redis required) |
| Media | Local or S3-compatible; Pillow + FFmpeg |
| Deploy | Docker Compose, Heroku, Render, Railway |

Do **not** introduce a SPA framework, Celery, or a third-party social aggregator unless explicitly asked.

## Layout

```
apps/           # Django domain apps (composer, calendar, publisher, inbox, …)
providers/      # One SocialProvider module per platform (+ registry)
templates/      # Server-rendered HTML + HTMX partials
theme/          # Tailwind source + white-label CSS tokens
config/         # Settings (development / production / test)
development_specs/  # architecture.md + feature-spec (F-* IDs)
tests/          # Cross-cutting tests (app tests live under apps/*/tests)
```

## Dev commands

```bash
make setup          # .env, deps, migrate
make server         # Django runserver (default :8000)
make worker         # background task worker
make tailwind       # CSS watcher
make test           # pytest
make lint           # ruff check + format --check
make format         # ruff fix + format
make typecheck      # mypy
docker compose up -d --build   # full stack (app :8000)
```

Local env: copy `.env.example` → `.env`. Never commit secrets. CI also runs gitleaks.

## Non-negotiables

1. **Tenant isolation** — query via `for_org` / `for_workspace` (see `apps/common/managers.py`). No cross-org/workspace data leaks.
2. **Secrets** — OAuth tokens and platform credentials use encrypted fields (`apps/common/encryption.py`). Never log them.
3. **Providers** — extend `providers.base.SocialProvider`, register in `PROVIDER_REGISTRY`. X/Twitter is out of scope.
4. **Publish status** — editorial/publish state lives on `PlatformPost`; `Post.status` is derived (`apps/composer/status.py`).
5. **Credentials at call sites** — resolve per-account credentials with `resolve_platform_credentials` before `get_provider`.
6. **Quality** — match CI: ruff, mypy, pytest. Prefer focused PRs; conventional commits (`feat(scope):`, `fix(scope):`).

## Specs before building

- Architecture: `development_specs/architecture.md`
- Features by ID: `development_specs/feature-spec-social-media-management-v2.md` (`F-1.1`, …)
- Some spec items are still roadmap (e.g. 2FA TOTP, full report builder). Check existing apps before inventing new ones.

## Cursor guidance

| Path | Purpose |
|------|---------|
| `.cursor/rules/` | Persistent conventions (stack, security, providers, frontend, Django apps) |
| `.cursor/commands/` | Slash workflows: `/pr-ready`, `/add-provider`, `/debug-publish`, `/implement-feature` |
| `.cursor/skills/` | Deep procedures: add provider, tenant-safe Django, publish engine, HTMX UI |

Read the matching skill when the task matches its description; do not paste entire feature specs into answers — cite `F-*` IDs and implement against existing apps.
