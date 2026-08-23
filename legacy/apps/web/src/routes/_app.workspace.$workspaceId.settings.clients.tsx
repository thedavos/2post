import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

export const Route = createFileRoute(
  "/_app/workspace/$workspaceId/settings/clients",
)({
  component: ClientsPage,
});

const styles = stylex.create({
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, marginBottom: spacing[4], color: colors.foreground },
  hint: { color: colors.mutedForeground, fontSize: fontSizes.sm, marginBottom: spacing[6] },
  form: { display: "flex", gap: spacing[3] },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    flex: 1,
  },
  linkBox: {
    marginTop: spacing[4],
    padding: spacing[4],
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.success,
    borderRadius: spacing[2],
    wordBreak: "break-all",
    fontSize: fontSizes.sm,
  },
});

function ClientsPage() {
  const { workspaceId } = Route.useParams();
  const [email, setEmail] = useState("");
  const [issuedLink, setIssuedLink] = useState<string | null>(null);

  const issueMutation = useMutation({
    mutationFn: () =>
      api.post<{ url: string; expiresAt: string }>(
        `/api/app/workspaces/${workspaceId}/portal/links`,
        { email },
      ),
    onSuccess: (result) => setIssuedLink(result.url),
  });

  return (
    <div>
      <h1 {...stylex.props(styles.title)}>Client Portal</h1>
      <p {...stylex.props(styles.hint)}>
        Issue a magic link so a client can review and approve posts without an
        account. Links last 30 days.
      </p>

      <Card>
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim()) issueMutation.mutate();
          }}
        >
          <input
            {...stylex.props(styles.input)}
            type="email"
            placeholder="client@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" disabled={!email.trim() || issueMutation.isPending}>
            Issue magic link
          </Button>
        </form>

        {issuedLink && (
          <div {...stylex.props(styles.linkBox)}>
            <strong>Send this link to the client:</strong>
            <br />
            <a href={issuedLink}>{issuedLink}</a>
          </div>
        )}
        {issueMutation.isError && (
          <p style={{ color: colors.destructive, marginTop: spacing[3], fontSize: fontSizes.sm }}>
            Could not issue the link — try again.
          </p>
        )}
      </Card>
    </div>
  );
}
