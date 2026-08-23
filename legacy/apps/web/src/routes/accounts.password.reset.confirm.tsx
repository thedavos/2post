import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, spacing } from "../styles/tokens.stylex";

export const Route = createFileRoute("/accounts/password/reset/confirm")({
  component: ResetConfirmPage,
});

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[6],
    backgroundColor: colors.background,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  },
  title: { fontSize: "1.5rem", fontWeight: 700, color: colors.foreground },
  form: { display: "flex", flexDirection: "column", gap: spacing[4], minWidth: 320 },
  label: { display: "flex", flexDirection: "column", gap: spacing[1], fontSize: "0.875rem" },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
  },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

function ResetConfirmPage() {
  const token = Route.useSearch() as { token?: string };
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>Set new password</h1>
      {done ? (
        <p style={{ color: colors.success }}>
          Password updated. <a href="/accounts/login">Sign in</a>
        </p>
      ) : (
        <Card>
          <form
            {...stylex.props(styles.form)}
            onSubmit={(event) => {
              event.preventDefault();
              api
                .post("/api/app/auth/reset-password", {
                  token: token ?? "",
                  password,
                })
                .then(() => setDone(true))
                .catch(() =>
                  setError("Invalid or expired link — request a new one."),
                );
            }}
          >
            <label {...stylex.props(styles.label)}>
              New password
              <input
                {...stylex.props(styles.input)}
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && <p {...stylex.props(styles.error)}>{error}</p>}
            <Button type="submit">Update password</Button>
          </form>
        </Card>
      )}
    </main>
  );
}
