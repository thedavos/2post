# Add provider

Guide adding a new first-party social platform to 2post. Follow the `add-social-provider` skill end-to-end.

## Checklist

1. New module under `providers/` implementing `SocialProvider`
2. Register in `PROVIDER_REGISTRY` (`providers/__init__.py`)
3. Add `PlatformCredential.Platform` value (+ `REQUIRED_CREDENTIAL_KEYS` if app credentials exist)
4. OAuth/PKCE wiring in `apps/social_accounts` (connect, reconnect, connection links)
5. Publish path works via publisher + `PublishContent` / platform-specific extras
6. Analytics scopes only in `analytics_only_scopes` when applicable
7. Tests for auth exchange, publish, and error mapping
8. Docs: README platform table + `.env.example` keys if needed

Refuse aggregators and X/Twitter. Prefer mirroring an existing similar provider (e.g. Meta family vs OAuth2 vs session auth).
