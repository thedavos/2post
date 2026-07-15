---
name: publish-engine
description: >-
  Explains and modifies 2post's publishing loop (PlatformPost status, retries,
  credentials, rate limits, worker). Use when debugging failed publishes,
  changing publisher/engine.py, schedule/queue publish behavior, or first-comment delays.
---

# Publish engine

## Mental model

1. Worker polls due `PlatformPost` rows (`scheduled_at <= now`, status `scheduled`) via `apps/publisher/engine.py`.
2. Transition to `publishing`, dispatch per platform (thread pool), write `PublishLog`.
3. Retries use `RETRY_BACKOFF` (1m / 5m / 30m). Rate limits tracked in `RateLimitState`.
4. Optional first comment after delay.
5. **Status ownership** is on `PlatformPost`. Parent `Post.status` is derived (`apps/composer/status.py`) — do not invent a second source of truth.

## Credentials

Always resolve per-account credentials before `get_provider`:

```python
from apps.credentials.models import resolve_platform_credentials
from providers import get_provider

creds = resolve_platform_credentials(...)
provider = get_provider(platform, credentials=creds)
```

Session-based providers (e.g. Bluesky) may need refresh immediately before publish.

## Debugging order

1. `PlatformPost` status + `scheduled_at` + error/log rows  
2. Is `process_tasks` running?  
3. Credentials / token expiry / reconnect flags  
4. Rate limit / backoff  
5. Provider-specific API quirks (Reels vs feed, container wait, etc.)

## Changes

Keep the loop idempotent. Prefer narrow provider or status-transition fixes over restructuring the engine. Add tests in `apps/publisher/tests.py` for status transitions and retry behavior.
