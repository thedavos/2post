import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface PortalPost {
  id: string;
  status: string;
  post: { id: string; caption: string; title: string };
}

export const Route = createFileRoute("/portal/$token")({
  component: PortalFeedPage,
});

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    padding: spacing[8],
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  },
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, marginBottom: spacing[2], color: colors.foreground },
  subtitle: { color: colors.mutedForeground, fontSize: fontSizes.sm, marginBottom: spacing[6] },
  list: { display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 },
  caption: { fontSize: fontSizes.sm, whiteSpace: "pre-wrap", marginBlock: spacing[3] },
  actions: { display: "flex", gap: spacing[3] },
  statusPill: {
    fontSize: fontSizes.xs,
    padding: "2px 8px",
    borderRadius: 9999,
    backgroundColor: colors.muted,
    color: colors.mutedForeground,
  },
  error: { color: colors.destructive },
});

function PortalFeedPage() {
  const { token } = Route.useParams();
  const feedQuery = useQuery({
    queryKey: ["portal-feed", token],
    queryFn: () =>
      api.get<{ workspace_id: string; email: string; results: PortalPost[] }>(
        `/api/app/portal/feed?token=${encodeURIComponent(token)}`,
      ),
    retry: false,
  });

  const decision = useMutation({
    mutationFn: (input: { platformPostId: string; decision: "approve" | "reject" }) =>
      api.post("/api/app/portal/decision", { token, ...input }),
    onSuccess: () => feedQuery.refetch(),
  });

  if (feedQuery.isError) {
    return (
      <main {...stylex.props(styles.page)}>
        <h1 {...stylex.props(styles.title)}>Client Review</h1>
        <p {...stylex.props(styles.error)}>
          This link is invalid or has expired. Ask your team for a fresh one.
        </p>
      </main>
    );
  }

  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>Content for your review</h1>
      <p {...stylex.props(styles.subtitle)}>
        {feedQuery.data ? `Signed in as ${feedQuery.data.email}` : "Loading…"}
      </p>

      <div {...stylex.props(styles.list)}>
        {(feedQuery.data?.results ?? []).map((item) => (
          <Card key={item.id}>
            <span {...stylex.props(styles.statusPill)}>{item.status.toLowerCase().replace("_", " ")}</span>
            <p {...stylex.props(styles.caption)}>{item.post.caption || item.post.title}</p>
            <div {...stylex.props(styles.actions)}>
              <Button
                onClick={() => decision.mutate({ platformPostId: item.id, decision: "approve" })}
                disabled={decision.isPending}
              >
                Approve
              </Button>
              <Button
                variant="destructive"
                onClick={() => decision.mutate({ platformPostId: item.id, decision: "reject" })}
                disabled={decision.isPending}
              >
                Reject
              </Button>
            </div>
          </Card>
        ))}
        {(feedQuery.data?.results.length ?? 0) === 0 && !feedQuery.isLoading && (
          <Card>No content pending your review.</Card>
        )}
      </div>
    </main>
  );
}
