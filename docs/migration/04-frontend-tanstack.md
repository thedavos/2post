# Frontend: TanStack Start + React

## 1. Stack decisions

- TanStack Start (SSR) + React 19, file-based routing via `@tanstack/react-router`.
- Server state: **TanStack Query** for all API data (mutations + optimistic updates replace HTMX swap patterns).
- Forms: react-hook-form + zod resolvers fed by `packages/shared` schemas.
- Client state: minimal — React context/zustand only where truly needed (composer editor state).
- Styling: StyleX only (see 05-stylex.md). No Tailwind in the new app.

## 2. Route map (Django URL → TanStack route)

Route files under `apps/web/src/routes/`. Paths keep today's shape so bookmarks and OAuth redirect registrations survive:

| Current URL | Route file | Notes |
|---|---|---|
| `/` (login/landing) | `index.tsx` | |
| `/accounts/login`, `/accounts/signup`, `/accounts/password/*`, `/accounts/2fa/*` | `account/$action.tsx` family | forms POST to API |
| `/organizations/*` | `organizations/…` | org switcher, settings tabs |
| `/organizations/api-keys/*` | `organizations/api-keys/…` | |
| `/workspaces/*` | `workspaces/…` | |
| `/members/*`, invitations | `members/…` | |
| `/settings/*` | `settings/…` | cascading defaults UI |
| `/social-accounts/*` (connect list) | `social-accounts/…` | **callbacks** stay server-side on the API (browser redirects through them unchanged) |
| `/workspace/$workspaceId/` dashboard/composer | `workspace/$workspaceId/index.tsx`, `composer.tsx` | composer is the most complex screen; per-platform overrides + live preview become client-side rendering (no more 500ms debounced server round-trip) |
| `/workspace/$workspaceId/calendar/*` | `calendar.tsx`, `calendar/month|week|day.tsx` | dnd via `@dnd-kit`; optimistic move → mutation with rollback |
| `/workspace/$workspaceId/inbox/*` | `inbox.tsx` | infinite scroll via `useInfiniteQuery` (`revealed` HTMX pattern), 30s refetch for new items |
| `/workspace/$workspaceId/analytics/*` | `analytics.tsx` | charts: reuse current charting choice (port as React component) |
| `/workspace/$workspaceId/approvals/*` | `approvals.tsx` | inline status updates = mutations |
| `/workspace/$workspaceId/media/*` | `media.tsx` | nested folders, drag reorder |
| `/workspace/$workspaceId/settings/clients/*` | `workspace/$workspaceId/settings/clients.tsx` | |
| `/portal/*` (client portal, magic link) | `portal/$token.tsx`, `portal/…` | token in URL preserved |
| `/notifications/*` | handled by header bell + `notifications.tsx` page | badge polled every 30 s |
| `/onboarding/*` | `onboarding/…` | |
| `/orgs/$orgId/intelligence/*` | `intelligence/…` | feature-flagged |

HTMX partials under `templates/**/_*.html` do not map to routes — they become components (`src/components/<domain>/…`) rendered client-side.

## 3. Data fetching conventions

```ts
// apps/web/src/lib/api.ts
export const api = {
  async get<T>(path: string): Promise<T> { /* fetch('/api' + path, { credentials: 'include' }) */ },
  // post/patch/delete analogous; throws ApiError parsed from problem+json
}
```

- Query keys follow `[domain, id?, params?]` in `packages/shared/src/query-keys.ts` so invalidation after mutations is consistent.
- Loaders use `ensureQueryData` for SSR-friendly prefetch; sensitive pages stay dynamic.
- The old CSRF token flow disappears; auth is JWT-in-cookie with SameSite=Lax (see 06).

## 4. Interaction-pattern translations

| Today (HTMX/Alpine) | Target (React) |
|---|---|
| `hx-post` partial swap | `useMutation` + query invalidation / optimistic update |
| Debounced composer preview (server-rendered HTML) | client-side preview components per platform (pure render from state) |
| Infinite scroll `hx-trigger="revealed"` | `useInfiniteQuery` + IntersectionObserver sentinel |
| Alpine dropdowns/modals/tabs/toggles | headless primitives (Radix) styled with StyleX |
| Alpine drag-and-drop + optimistic revert | `@dnd-kit` + `useMutation(onMutate/onError rollback)` |
| Character counter from data attributes | shared platform-limit constants from `packages/shared` |
| Notification badge polling | `refetchInterval: 30_000` |
| Django messages flash framework | toast system (sonner) wired to router/loader results |

## 5. Parity requirements

- Every user-visible flow must exist before cutover: login (incl. Google SSO), onboarding wizard, org/workspace/member management incl. invitations and custom roles, social account connect/disconnect for all 13 platforms, composer (overrides, templates, versions, idea board), calendar (slots, queues, recurring, drag-drop), approvals (incl. client comments), publisher status views, inbox (threaded replies, sentiment badges, assignment, backfill trigger), analytics (KPI cards, trend charts, posts table, post detail), media library (folders, variants, Unsplash search), client portal, notifications prefs, API keys UI, whitelabel branding, intelligence surfaces (if enabled).
- Visual parity: same layout, sidebar/nav structure, colors, spacing. Port `tailwind.config.js` tokens first (05-stylex.md §2) so class-for-class conversions land pixel-close.
- E2E suite (Playwright) written against staging covers the critical paths above; it must pass against both stacks during phase 3–4 (dual-target selectors) to prove parity.
