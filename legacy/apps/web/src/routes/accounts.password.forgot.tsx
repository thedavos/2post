import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, spacing } from "../styles/tokens.stylex";

export const Route = createFileRoute("/accounts/password/forgot")({
  component: ForgotPasswordPage,
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
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>Reset your password</h1>
      {sent ? (
        <p style={{ color: colors.success }}>
          If an account exists for that email, a reset link has been sent.
        </p>
      ) : (
        <Card>
          <form
            {...stylex.props(styles.form)}
            onSubmit={(event) => {
              event.preventDefault();
              void api.post("/api/app/auth/forgot-password", { email }).then(() => setSent(true));
            }}
          >
            <label {...stylex.props(styles.label)}>
              Email
              <input
                {...stylex.props(styles.input)}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <Button type="submit">Send reset link</Button>
          </form>
        </Card>
      )}
    </main>
  );
}
