---
name: htmx-alpine-ui
description: >-
  Builds 2post UI with Django templates, HTMX partials, Alpine.js, and Ember
  CSS tokens. Use when editing templates, adding HTMX endpoints, toasts,
  composer/calendar UI, or white-label theming.
---

# HTMX + Alpine UI

## Split of responsibilities

| Concern | Tool |
|---------|------|
| Fetch/swap HTML, forms, infinite scroll | HTMX |
| Dropdowns, tabs, modals, DnD, local counters | Alpine.js |
| Brand colors / white-label | CSS variables in `theme/static_src/src/styles.css` |

No React/Vue SPA. No new JS bundler for app code.

## Patterns

- Return partial templates for `hx-get` / `hx-post` swaps; keep full-page templates for first paint.
- Empty 204 + triggers for toast/refresh:

```python
from apps.common.htmx import toast_response

return toast_response(tone="success", title="Saved", events={"approvalAction": True})
```

- After Alpine drag-and-drop, persist with `hx-post`; revert UI on failure.
- Composer preview: debounce (~500ms); keep the preview view light.

## Theming

- Edit **Layer 1 brand tokens** (`--brand-*`) only when rebranding.
- Semantic (`--primary`, …) and component tokens must reference brand/semantic vars.
- Runtime white-label may override CSS variables on `<html>` — do not assume a single hardcoded primary in components.

## Checklist

- [ ] Works without full page reload where peers use HTMX  
- [ ] Tenant-safe query in the partial’s view  
- [ ] Toast/refresh events named consistently with existing listeners  
- [ ] No Brightbean naming or old brand colors introduced  
