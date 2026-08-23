import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

const TABS = ["PENDING_REVIEW", "PENDING_CLIENT", "CHANGES_REQUESTED", "REJECTED", "APPROVED"] as const;

/** Allowed next editorial states per current tab (legacy transition table subset). */
const ACTIONS_BY_TAB: Record<
  (typeof TABS)[number],
  Array<{ label: string; to: string; variant: "primary" | "outline" | "destructive" }>
> = {
  PENDING_REVIEW: [
    { label: "Approve", to: "approved", variant: "primary" },
    { label: "Request changes", to: "changes_requested", variant: "outline" },
    { label: "Reject", to: "rejected", variant: "destructive" },
  ],
  PENDING_CLIENT: [
    { label: "Approve", to: "approved", variant: "primary" },
    { label: "Request changes", to: "changes_requested", variant: "outline" },
    { label: "Reject", to: "rejected", variant: "destructive" },
  ],
  CHANGES_REQUESTED: [
    { label: "Resubmit for review", to: "pending_review", variant: "primary" },
  ],
  REJECTED: [{ label: "Back to review", to: "pending_review", variant: "primary" }],
  APPROVED: [
    { label: "Put on hold", to: "on_hold", variant: "outline" },
    { label: "Revoke approval", to: "pending_review", variant: "destructive" },
  ],
};

export const Route = createFileRoute("/_app/workspace/$workspaceId/approvals")({
  component: ApprovalsPage,
});

const styles = stylex.create({
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, marginBottom: spacing[4], color: colors.foreground },
  tabs: { display: "flex", gap: spacing[2], marginBottom: spacing[4], flexWrap: "wrap" },
  list: { display: "flex", flexDirection: "column", gap: spacing[3] },
  caption: { fontSize: fontSizes.sm, whiteSpace: "pre-wrap", marginBlock: spacing[2], color: colors.foreground },
  actions: { display: "flex", gap: spacing[2], flexWrap: "wrap" },
  empty: { color: colors.mutedForeground, fontSize: fontSizes.sm },
});

function ApprovalsPage() {
  const { workspaceId } = Route.useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>("PENDING_REVIEW");

  // The posts list includes platformPosts with statuses; filter client-side.
  const postsQuery = useQuery({
    queryKey: ["posts-approvals", workspaceId],
    queryFn: () =>
      api.get<{
        results: Array<{
          id: string;
          title: string;
          caption: string;
          platformPosts: Array<{ id: string; status: string; socialAccountId: string }>;
        }>;
      }>(`/api/app/workspaces/${workspaceId}/posts`),
    refetchInterval: 60_000,
  });

  const transition = useMutation({
    mutationFn: (input: { platformPostId: string; to: string }) =>
      api.post(
        `/api/app/workspaces/${workspaceId}/posts/platform-posts/${input.platformPostId}/status`,
        { status: input.to },
      ),
    onSuccess: () => postsQuery.refetch(),
  });

  const matching = (postsQuery.data?.results ?? [])
    .flatMap((post) =>
      post.platformPosts.map((pp) => ({ pp, post })),
    )
    .filter(({ pp }) => pp.status === tab);

  return (
    <div>
      <h1 {...stylex.props(styles.title)}>Approvals</h1>

      <div {...stylex.props(styles.tabs)}>
        {TABS.map((t) => (
          <Button
            key={t}
            variant={tab === t ? "primary" : "outline"}
            onClick={() => setTab(t)}
          >
            {t.toLowerCase().replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      <div {...stylex.props(styles.list)}>
        {matching.map(({ pp, post }) => (
          <Card key={pp.id}>
            <div style={{ fontWeight: 600, fontSize: fontSizes.sm }}>
              {post.title || "(untitled)"}
            </div>
            <p {...stylex.props(styles.caption)}>
              {post.caption.slice(0, 280)}
              {post.caption.length > 280 ? "…" : ""}
            </p>
            <div {...stylex.props(styles.actions)}>
              {(ACTIONS_BY_TAB[tab] ?? []).map((action) => (
                <Button
                  key={action.to}
                  variant={action.variant}
                  disabled={transition.isPending}
                  onClick={() =>
                    transition.mutate({ platformPostId: pp.id, to: action.to })
                  }
                >
                  {action.label}
                </Button>
              ))}
            </div>
            {transition.isError && (
              <p style={{ color: colors.destructive, fontSize: fontSizes.xs, marginTop: spacing[2] }}>
                Invalid state transition — refresh and try again.
              </p>
            )}
          </Card>
        ))}
        {matching.length === 0 && !postsQuery.isLoading && (
          <Card>
            <span {...stylex.props(styles.empty)}>
              Nothing in {tab.toLowerCase().replace(/_/g, " ")}.
            </span>
          </Card>
        )}
      </div>
    </div>
  );
}
