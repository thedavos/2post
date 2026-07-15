---
name: add-social-provider
description: >-
  Adds or extends a first-party social platform provider in 2post (OAuth/PKCE,
  registry, credentials, publish). Use when adding a platform, implementing
  SocialProvider, wiring connect/reconnect, or changing provider scopes.
---

# Add social provider

## Steps

1. **Pick a sibling** — copy patterns from the closest existing provider (Meta Graph, LinkedIn OAuth2, TikTok PKCE, Bluesky session, DEV.to API key).
2. **Implement** `providers/<platform>.py` subclassing `SocialProvider`:
   - Metadata: `platform_name`, `auth_type`, caption/media limits, `required_scopes`
   - `analytics_only_scopes` for scopes only needed when analytics is enabled
   - `uses_pkce = True` when required; honor `code_verifier` in auth URL + token exchange
   - `account_metrics_supports_date_range` if lifetime-only metrics
3. **Register** in `PROVIDER_REGISTRY` (`providers/__init__.py`).
4. **Credentials model** — add `PlatformCredential.Platform` choice; update `REQUIRED_CREDENTIAL_KEYS` if app-level keys are required (note TikTok uses `client_key`).
5. **Social accounts** — ensure connect/reconnect/connection-link flows pass PKCE and resolve org credentials the same way as peers.
6. **Publisher** — `publish_post` accepts `PublishContent`; map platform-specific extras via `platform_extra` / provider fields. Call sites must use `resolve_platform_credentials` then `get_provider`.
7. **Tests** — mock HTTP; cover token exchange, publish success, rate-limit/error mapping.
8. **Docs** — README platform matrix + `.env.example` variable names.

## Do not

- Use Ayrshare/Outstand/other aggregators
- Add X/Twitter
- Put analytics-only scopes into `required_scopes` when they belong in `analytics_only_scopes`
