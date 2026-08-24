import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface AccountRow {
  id: string;
  platform: string;
  accountName: string;
  accountHandle: string;
  avatarUrl: string;
  followerCount: number;
  connectionStatus: string;
}

/// OAuth platforms open the provider in a new window; session platforms
/// (bluesky/devto) ask for credentials inline.
const OAUTH_PLATFORMS = [
  { slug: "facebook", label: "Facebook" },
  { slug: "instagram", label: "Instagram" },
  { slug: "instagram_login", label: "Instagram (Direct)" },
  { slug: "threads", label: "Threads" },
  { slug: "linkedin_personal", label: "LinkedIn (Personal)" },
  { slug: "linkedin_company", label: "LinkedIn (Company)" },
  { slug: "tiktok", label: "TikTok" },
  { slug: "youtube", label: "YouTube" },
  { slug: "google_business", label: "Google Business Profile" },
  { slug: "pinterest", label: "Pinterest" },
] as const;

const CREDENTIAL_PLATFORMS = [
  { slug: "bluesky", label: "Bluesky", fields: ["handle", "appPassword"] },
  { slug: "devto", label: "DEV.to", fields: ["apiKey"] },
  { slug: "mastodon", label: "Mastodon", fields: ["instanceUrl"] },
] as const;

export const Route = createFileRoute(
  "/_app/workspace/$workspaceId/social-accounts",
)({
  component: SocialAccountsPage,
});

const styles = stylex.create({
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, marginBottom: spacing[6], color: colors.foreground },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: spacing[4] },
  accountCard: { display: "flex", alignItems: "center", gap: spacing[3] },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    backgroundColor: colors.muted,
  },
  accountName: { fontWeight: 600, fontSize: fontSizes.sm },
  handle: { color: colors.mutedForeground, fontSize: fontSizes.xs },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: 600,
    marginTop: spacing[8],
    marginBottom: spacing[4],
    color: colors.foreground,
  },
  connectRow: { display: "flex", flexWrap: "wrap", gap: spacing[2] },
  inlineForm: { display: "flex", gap: spacing[2], flexWrap: "wrap", alignItems: "center" },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    fontSize: fontSizes.sm,
  },
  platformName: { fontWeight: 600, marginBottom: spacing[3] },
});

function SocialAccountsPage() {
  const { workspaceId } = Route.useParams();
  const accountsQuery = useQuery({
    queryKey: ["social-accounts", workspaceId],
    queryFn: () =>
      api.get<{ results: AccountRow[] }>(
        `/api/app/workspaces/${workspaceId}/social-accounts`,
      ),
  });

  const oauthConnect = useMutation({
    mutationFn: async (platform: string) => {
      const result = await api.post<{ mode: string; authUrl?: string }>(
        `/api/app/workspaces/${workspaceId}/social-accounts/connect/${platform}`,
        {},
      );
      if (result.mode === "redirect" && result.authUrl) {
        // Full-page redirect to the platform consent screen.
        window.location.href = result.authUrl;
      }
    },
  });

  const credentialConnect = useMutation({
    mutationFn: async (input: { slug: string; values: Record<string, string> }) => {
      return api.post(
        `/api/app/workspaces/${workspaceId}/social-accounts/connect/${input.slug}`,
        input.values,
      );
    },
    onSuccess: () => accountsQuery.refetch(),
  });

  const disconnectMutation = useMutation({
    mutationFn: (accountId: string) =>
      api.delete(`/api/app/workspaces/${workspaceId}/social-accounts/${accountId}`),
    onSuccess: () => accountsQuery.refetch(),
  });

  const [credentialValues, setCredentialValues] = useState<Record<string, Record<string, string>>>({});

  return (
    <div>
      <h1 {...stylex.props(styles.title)}>Connected channels</h1>

      <div {...stylex.props(styles.grid)}>
        {(accountsQuery.data?.results ?? []).map((account) => (
          <Card key={account.id}>
            <div {...stylex.props(styles.accountCard)}>
              <img
                src={account.avatarUrl || "/favicon.svg"}
                alt=""
                {...stylex.props(styles.avatar)}
              />
              <div style={{ flex: 1 }}>
                <div {...stylex.props(styles.accountName)}>{account.accountName}</div>
                <div {...stylex.props(styles.handle)}>
                  {account.platform} · @{account.accountHandle || "—"}
                </div>
              </div>
              <Button
                variant="destructive"
                onClick={() => disconnectMutation.mutate(account.id)}
                disabled={disconnectMutation.isPending}
              >
                Disconnect
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <h2 {...stylex.props(styles.sectionTitle)}>OAuth channels</h2>
      <div {...stylex.props(styles.connectRow)}>
        {OAUTH_PLATFORMS.map((platform) => (
          <Button
            key={platform.slug}
            variant="outline"
            disabled={oauthConnect.isPending}
            onClick={() => oauthConnect.mutate(platform.slug)}
          >
            Connect {platform.label}
          </Button>
        ))}
      </div>

      <h2 {...stylex.props(styles.sectionTitle)}>Credential channels</h2>
      <div {...stylex.props(styles.grid)}>
        {CREDENTIAL_PLATFORMS.map((platform) => (
          <Card key={platform.slug}>
            <div {...stylex.props(styles.platformName)}>{platform.label}</div>
            <form
              {...stylex.props(styles.inlineForm)}
              onSubmit={(event) => {
                event.preventDefault();
                credentialConnect.mutate({
                  slug: platform.slug,
                  values: credentialValues[platform.slug] ?? {},
                });
              }}
            >
              {platform.fields.map((field) => (
                <input
                  key={field}
                  {...stylex.props(styles.input)}
                  placeholder={field.replace(/([A-Z])/g, " $1").toLowerCase()}
                  value={credentialValues[platform.slug]?.[field] ?? ""}
                  type={field.toLowerCase().includes("password") || field === "apiKey" ? "password" : "text"}
                  onChange={(e) =>
                    setCredentialValues((prev) => ({
                      ...prev,
                      [platform.slug]: {
                        ...(prev[platform.slug] ?? {}),
                        [field]: e.target.value,
                      },
                    }))
                  }
                  required
                />
              ))}
              <Button type="submit">Connect</Button>
            </form>
          </Card>
        ))}
      </div>
    </div>
  );
}
