# Implement feature

Implement a feature from the product spec with minimal blast radius.

## Steps

1. Ask for or extract the feature ID (`F-x.y`). Read the matching section in `development_specs/feature-spec-social-media-management-v2.md` and related notes in `architecture.md`.
2. Map to existing apps under `apps/` — extend them; do not create a new app unless the domain is truly missing (check roadmap gaps like 2FA / full reports).
3. Produce a short plan: models, views/API, tasks, templates, permissions, tests.
4. Implement in thin vertical slices; keep tenant scoping and encrypted secrets rules.
5. Add/adjust pytest coverage for the happy path and one authz/tenant negative case.
6. Note any intentional deviations from the spec (already shipped differently, deferred).

If the ID is ambiguous, list candidate `F-*` sections before coding.
