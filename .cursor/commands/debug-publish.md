# Debug publish

Diagnose why a post did not publish (or partially published). Use the `publish-engine` skill.

## Checklist

1. Locate the `PlatformPost` row(s): `status`, `scheduled_at`, account, platform, last error fields / related `PublishLog`
2. Confirm worker is running: `python manage.py process_tasks` (or Docker `worker` service)
3. Verify credentials: `resolve_platform_credentials` for that account; token not expired; Bluesky/session platforms refreshed before publish
4. Check rate-limit state (`RateLimitState`) and retry backoff (`RETRY_BACKOFF` in `apps/publisher/engine.py`)
5. Confirm status ownership: child `PlatformPost` statuses drive derived `Post.status` — do not “fix” by only writing the parent
6. Reproduce with the smallest failing platform; compare against a known-good provider path
7. Propose a focused fix + test; avoid broad refactors of the publish loop

Report: symptom → evidence (IDs/statuses/logs) → likely root cause → next fix.
