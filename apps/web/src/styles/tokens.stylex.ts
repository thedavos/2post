import * as stylex from "@stylexjs/stylex";

/**
 * Token port from 2post-logo-refresh theme/static_src/src/styles.css.
 * Three-layer white-label architecture:
 *   Layer 1 → Brand Tokens   (swap these to white-label)
 *   Layer 2 → Semantic Tokens (reference brand tokens)
 *   Layer 3 → Component Tokens (reference semantic tokens)
 *
 * To rebrand: change ONLY the brand token values below.
 */

// ─── Brand Tokens — Ember (warm orange) ─────────────────────────────

export const brand = stylex.defineVars({
  50: "#FFF7ED",
  100: "#FFEDD5",
  200: "#FED7AA",
  300: "#FDBA74",
  400: "#FB923C",
  500: "#EA580C",
  600: "#C2410C",
  700: "#9A3412",
  800: "#7C2D12",
  900: "#7C2D12",
});

export const brandGreen = stylex.defineVars({
  100: "#EFF2DC",
  200: "#DDE4B9",
  500: "#94A43F",
  600: "#7B8A33",
});

// ─── Neutrals — warm stone ──────────────────────────────────────────

const neutral = {
  50: "#FAFAF9", 100: "#F5F5F4", 200: "#E7E5E4", 300: "#D6D3D1",
  400: "#A8A29E", 500: "#78716C", 600: "#57534E", 700: "#44403C",
  800: "#292524", 900: "#1C1917", 950: "#171412",
} as const;

// ─── Semantic Tokens ────────────────────────────────────────────────

export const colors = stylex.defineVars({
  brandPrimary: "var(--brand-primary, #EA580C)",
  brandPrimaryHover: "var(--brand-primary-hover, #C2410C)",
  brandSecondary: "var(--brand-secondary, #9A3412)",

  primary: "var(--brand-500, #EA580C)",
  primaryHover: "var(--brand-600, #C2410C)",
  primarySoft: "var(--brand-50, #FFF7ED)",
  primaryMuted: "var(--brand-100, #FFEDD5)",
  primaryRing: "var(--brand-200, #FED7AA)",
  primaryForeground: "#ffffff",

  background: "rgb(247, 246, 242)",
  surface: neutral[50],
  surfaceElevated: "#FFFFFF",
  foreground: neutral[900],
  muted: neutral[100],
  mutedForeground: neutral[500],
  border: neutral[200],
  borderHover: neutral[300],
  destructive: "#EF4444",
  success: "#22C55E",
  warning: "#EAB308",

  sidebar: neutral[950],
  sidebarForeground: neutral[400],
  sidebarActive: "var(--brand-500, #EA580C)",

  greenAccent: "#94A43F",
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
  sm: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
  "2xl": "1rem",
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

export const shadows = stylex.defineVars({
  xs: "0 1px 2px rgba(23,20,18,0.05)",
  sm: "0 1px 3px rgba(23,20,18,0.08), 0 1px 2px rgba(23,20,18,0.04)",
  md: "0 4px 6px rgba(23,20,18,0.06), 0 2px 4px rgba(23,20,18,0.04)",
});
