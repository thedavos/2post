import * as stylex from "@stylexjs/stylex";

// Phase 0 placeholder values — replace with the exact port of
// theme/static_src/tailwind.config.js during the CSS migration (05-stylex.md §2).
export const colors = stylex.defineVars({
  primary: "#FFB300",
  primaryForeground: "#1a1a1a",
  background: "#ffffff",
  foreground: "#171717",
  muted: "#f5f5f5",
  mutedForeground: "#737373",
  destructive: "#dc2626",
  border: "#e5e5e5",
});

export const spacing = stylex.defineVars({
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  6: "24px",
  8: "32px",
});

export const radii = stylex.defineVars({
  sm: "4px",
  md: "8px",
  lg: "12px",
  full: "9999px",
});
