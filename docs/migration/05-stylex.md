# CSS: StyleX Migration

Reference: the `tailwind-to-stylex` skill workflow applies to every conversion (resolve class → computed CSS → StyleX object). This doc defines project-level setup and tokens.

## 1. Setup

- `@stylexjs/stylex` + `@stylexjs/vite-plugin` in `apps/web/vite.config.ts` (TanStack Start is Vite-based).
- ESLint plugin `@stylexjs/eslint-plugin` enforced in CI (catches invalid shorthands, missing `default`, unknown properties).
- React DOM target → use `stylex.props(...)` everywhere.
- Rules of engagement:
  - camelCase properties; longhand over multi-value shorthands (`borderWidth/Style/Color`, not `border: '1px solid red'`; two-value `padding` → `paddingBlock`/`paddingInline`). Single-value shorthand ok.
  - Numbers = px. Other units stay strings.
  - Conditions live inside values with a **required** `default` key: `{ default: null, ':hover': … }`.
  - Mobile-first responsive via `@media (min-width: …)` keys — breakpoints ported from Tailwind config (sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536).
  - No descendant-selector utilities exist in StyleX: `space-x-*` → parent `gap`; `divide-*` → borders on children; `group-hover`/`peer` → lifted state or CSS variables.

## 2. Token system (port of tailwind.config.js)

Create `apps/web/src/styles/tokens.stylex.ts` using `stylex.defineVars`:

```ts
export const colors = stylex.defineVars({
  // ← copy exact values from tailwind.config.js theme.extend.colors
  primary: '#…', primaryForeground: '…',
  background: '…', foreground: '…',
  muted: '…', mutedForeground: '…',
  destructive: '…', border: '…',
});
export const spacing = stylex.defineVars({ /* scale */ });
export const radii = stylex.defineVars({ /* rounded-* equivalents */ });
```

Semantic theming for white-label workspaces (per-org brand colors injected today as CSS custom properties on `<html>`): define `brandVars` with `defineVars` and override per workspace root via `stylex.createTheme` + inline theme key — this replaces runtime CSS-variable injection without a rebuild, exactly like today.

Dark mode: if currently supported via a `dark:` strategy, replicate with `.dark` theme class using `createTheme`.

Typography scale, shadows, z-index layers: same file, one `defineVars` per category. Component styles reference only these vars — no raw hex outside `tokens.stylex.ts`.

## 3. Component conventions

- Styles co-located per component file:

```tsx
const styles = stylex.create({
  base: { display: 'inline-flex', alignItems: 'center', borderRadius: radii.full,
          paddingInline: spacing[2], paddingBlock: spacing[1] },
});

export function Badge({ active }: Props) {
  return <span {...stylex.props(styles.base, active ? styles.active : styles.muted)}>…</span>;
}
```

- Named entries per element/variant (`base`, `label`, `iconActive`) — no `$1/$2`.
- Composition order = last wins, mirroring current `cn(...)` semantics; caller overrides passed as final `style?: StyleXStyles` prop.
- Shared primitives first: build `Button`, `Input`, `Card`, `Modal`, `DropdownMenu`, `Table`, `Badge`, `Tabs`, `Toast` in `src/components/ui/` before migrating screens, so screen conversions mostly compose primitives.

## 4. Conversion procedure (per template)

1. Read Django template + identify every Tailwind class incl. conditionals set by template context or Alpine toggles.
2. Resolve each class to computed CSS (respecting the project's tailwind config), reshape into `stylex.create`.
3. Convert Alpine state (`x-data`, `@click`, etc.) into React state alongside the style change.
4. Flag anything not 1:1 (`group-*`, `peer-*`, arbitrary selectors, JS-injected classes) instead of silently changing design.
5. Visual check against the Django-rendered page at sm/md/lg breakpoints.

## 5. Definition of done

- Zero `className` strings containing Tailwind utilities in migrated files; zero `tailwind.config` references.
- ESLint StyleX rules pass; typecheck passes.
- Side-by-side screenshot parity at 375 / 768 / 1440 px widths for migrated screens (stored under `docs/migration/screenshots/` during phase 3).
