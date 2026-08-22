import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, spacing } from "../styles/tokens.stylex";

export const Route = createFileRoute("/accounts/signup")({
  component: SignupPage,
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
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  title: { fontSize: "1.875rem", fontWeight: 700, color: colors.foreground },
  form: { display: "flex", flexDirection: "column", gap: spacing[4], minWidth: 320 },
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
    ":focus": { outlineStyle: "solid", outlineWidth: 2, outlineColor: colors.primary },
  },
  tos: { display: "flex", gap: spacing[2], alignItems: "center", fontSize: "0.8125rem" },
  error: { color: colors.destructive, fontSize: "0.875rem" },
  link: { color: colors.primary, fontSize: "0.875rem", textDecoration: "none" },
});

function SignupPage() {
  const navigate = Route.useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptTos, setAcceptTos] = useState(false);

  const mutation = useMutation({
    mutationFn: async () =>
      api.post("/api/app/auth/signup", {
        email,
        password,
        displayName,
        acceptTos,
      }),
    onSuccess: async () => {
      await navigate({ to: "/" });
    },
  });

  const conflict =
    mutation.isError && mutation.error instanceof Error && mutation.error.message.includes("already exists");

  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>Create your account</h1>

      <Card>
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();
            if (acceptTos) mutation.mutate();
          }}
        >
          <label {...stylex.props(styles.label)}>
            Name
            <input
              {...stylex.props(styles.input)}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </label>
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
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <label {...stylex.props(styles.tos)}>
            <input
              type="checkbox"
              checked={acceptTos}
              onChange={(e) => setAcceptTos(e.target.checked)}
              required
            />
            I accept the Terms of Service
          </label>

          {conflict && (
            <p {...stylex.props(styles.error)}>An account with this email already exists</p>
          )}
          {mutation.isError && !conflict && (
            <p {...stylex.props(styles.error)}>Signup failed — check your details.</p>
          )}

          <Button type="submit" disabled={!acceptTos || mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create account"}
          </Button>
        </form>
      </Card>

      <a href="/accounts/login" {...stylex.props(styles.link)}>
        Already have an account? Sign in
      </a>
    </main>
  );
}
