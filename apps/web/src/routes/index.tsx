import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";

import { colors } from "../styles/tokens.stylex";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
});

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>BrightBean Studio</h1>
      <p {...stylex.props(styles.subtitle)}>
        New stack scaffold — TanStack Start + StyleX. Migration phase 0.
      </p>
    </main>
  );
}
