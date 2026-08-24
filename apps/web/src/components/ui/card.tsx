import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { colors, radii, spacing } from "../../styles/tokens.stylex";

const styles = stylex.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing[6],
  },
});

export function Card({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.card)}>{children}</div>;
}
