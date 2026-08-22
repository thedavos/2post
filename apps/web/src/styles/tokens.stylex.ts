import * as stylex from "@stylexjs/stylex";

/**
 * Token port from theme/static_src/tailwind.config.js + base.html.
 * Brand colors remain CSS-var overridable for white-label workspaces
 * (createTheme overrides applied at the workspace root at runtime).
 */

// Tailwind indigo scale (legacy default palette usage centers on indigo).
const indigo = {
  50: "#eef2ff",
  100: "#e0e7ff",
  200: "#c7d2fe",
  300: "#a5b4fc",
  400: "#818cf8",
  500: "#6366f1",
  600: "#4f46e5",
  700: "#4338ca",
  800: "#3730a3",
  900: "#312e81",
} as const;

const gray = {
  50: "#f9fafb",
  100: "#f3f4f6",
  200: "#e5e7eb",
  300: "#d1d5db",
  400: "#9ca3af",
  500: "#6b7280",
  600: "#4b5563",
  700: "#374151",
  800: "#1f2937",
  900: "#111827",
} as const;

export const colors = stylex.defineVars({
  // White-label overridables — same defaults as --brand-* custom properties.
  brandPrimary: "var(--brand-primary, #4f46e5)",
  brandPrimaryHover: "var(--brand-primary-hover, #4338ca)",
  brandSecondary: "var(--brand-secondary, #7c3aed)",

  background: gray[50],
  surface: "#ffffff",
  foreground: gray[900],
  muted: gray[100],
  mutedForeground: gray[500],
  border: gray[200],
  destructive: "#dc2626",
  success: "#16a34a",
  warning: "#f59e0b",

  primary: indigo[600],
  primaryForeground: "#ffffff",
  primaryHover: indigo[700],

  sidebar: gray[900],
  sidebarForeground: gray[300],
  sidebarActive: indigo[500],
});

export const spacing = stylex.defineVars({
  px: "1px",
  0: "0px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
});

export const radii = stylex.defineVars({
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "9999px",
});

export const fontSizes = stylex.defineVars({
  xs: "0.75rem",
  sm: "0.875rem",
  base: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
  "3xl": "1.875rem",
});
