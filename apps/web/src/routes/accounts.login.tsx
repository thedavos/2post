import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { colors, spacing } from "../styles/tokens.stylex";
import { login, sessionQuery } from "~/features/auth/session";
import { queryClient } from "~/lib/query-client";

export const Route = createFileRoute("/accounts/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: LoginPage,
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
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  title: { fontSize: "1.875rem", fontWeight: 700, color: colors.foreground },
  subtitle: { fontSize: "0.875rem", color: colors.mutedForeground },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: spacing[4],
    minWidth: 320,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: spacing[1],
    fontSize: "0.875rem",
    color: colors.foreground,
  },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    ":focus": {
      outlineStyle: "solid",
      outlineWidth: 2,
      outlineColor: colors.primary,
      borderColor: "transparent",
    },
  },
  error: { color: colors.destructive, fontSize: "0.875rem" },
  link: { color: colors.primary, fontSize: "0.875rem", textDecoration: "none" },
});

function LoginPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQuery().queryKey });
      await navigate({ to: search.redirect ?? "/", search: { redirect: undefined, error: undefined } });
    },
  });

  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>BrightBean Studio</h1>
      <p {...stylex.props(styles.subtitle)}>Sign in to your workspace</p>

      <Card>
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <label {...stylex.props(styles.label)}>
            Email
            <input
              {...stylex.props(styles.input)}
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label {...stylex.props(styles.label)}>
            Password
            <input
              {...stylex.props(styles.input)}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {search.error && (
            <p {...stylex.props(styles.error)}>Google sign-in failed — please try again.</p>
          )}
          {mutation.isError && (
            <p {...stylex.props(styles.error)}>Invalid email or password</p>
          )}

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </Button>

          <div style={{ textAlign: "center", fontSize: "0.8125rem", color: colors.mutedForeground }}>
            or
          </div>

          <a href="/api/app/auth/google" style={{ textDecoration: "none" }}>
            <Button type="button" variant="outline">
              Continue with Google
            </Button>
          </a>
        </form>
      </Card>

      <a href="/accounts/signup" {...stylex.props(styles.link)}>
        Create an account
      </a>
    </main>
  );
}
