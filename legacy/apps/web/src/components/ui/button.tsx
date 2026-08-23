import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";

import { colors, radii, spacing } from "../../styles/tokens.stylex";

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radii.md,
    fontSize: "0.875rem",
    fontWeight: 500,
    paddingBlock: spacing[2],
    paddingInline: spacing[4],
    cursor: "pointer",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    transitionProperty: "background-color, border-color, color",
    transitionDuration: "150ms",
    ":disabled": { opacity: 0.5, cursor: "not-allowed" },
  },
  primary: {
    backgroundColor: colors.primary,
    color: colors.primaryForeground,
    ":hover": { backgroundColor: colors.primaryHover },
  },
  outline: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    color: colors.foreground,
    ":hover": { backgroundColor: colors.muted },
  },
  ghost: {
    backgroundColor: "transparent",
    color: colors.foreground,
    ":hover": { backgroundColor: colors.muted },
  },
  destructive: {
    backgroundColor: colors.destructive,
    color: "#ffffff",
  },
});

export type ButtonVariant = "primary" | "outline" | "ghost" | "destructive";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", children, ...rest }: ButtonProps) {
  const variantStyles = {
    primary: styles.primary,
    outline: styles.outline,
    ghost: styles.ghost,
    destructive: styles.destructive,
  }[variant];

  return (
    <button {...stylex.props(styles.base, variantStyles)} {...rest}>
      {children}
    </button>
  );
}
