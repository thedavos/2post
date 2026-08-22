import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface MessageRow {
  id: string;
  messageType: string;
  status: string;
  sentiment: string;
  senderName: string;
  senderHandle: string;
  body: string;
  createdAt: string;
  socialAccount: { platform: string; accountName: string };
}

const STATUS_FILTERS = ["UNREAD", "OPEN", "RESOLVED", "ARCHIVED"] as const;

export const Route = createFileRoute("/_app/workspace/$workspaceId/inbox")({
  component: InboxPage,
});

const styles = stylex.create({
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, marginBottom: spacing[4], color: colors.foreground },
  filters: { display: "flex", gap: spacing[2], marginBottom: spacing[4] },
  list: { display: "flex", flexDirection: "column", gap: spacing[3] },
  messageHeader: {
    display: "flex",
    alignItems: "center",
    gap: spacing[2],
    marginBottom: spacing[2],
    fontSize: fontSizes.sm,
  },
  sender: { fontWeight: 600 },
  meta: { color: colors.mutedForeground, fontSize: fontSizes.xs },
  body: { fontSize: fontSizes.sm, marginBottom: spacing[3], whiteSpace: "pre-wrap" },
  actions: { display: "flex", gap: spacing[2], alignItems: "center" },
  replyForm: {
    display: "flex",
    flexDirection: "column",
    gap: spacing[2],
    marginTop: spacing[3],
  },
  replyRow: { display: "flex", gap: spacing[2] },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    flex: 1,
    fontFamily: "inherit",
  },
  badge: {
    fontSize: fontSizes.xs,
    padding: "1px 6px",
    borderRadius: 9999,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
  },
  badgeUnread: { backgroundColor: "#dbeafe", color: "#1e40af", borderColor: "transparent" },
  badgeNegative: { backgroundColor: "#fee2e2", color: "#991b1b", borderColor: "transparent" },
});

function InboxPage() {
  const { workspaceId } = Route.useParams();
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("UNREAD");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const inboxQuery = useQuery({
    queryKey: ["inbox", workspaceId, statusFilter],
    queryFn: () =>
      api.get<{ results: MessageRow[] }>(
        `/api/app/workspaces/${workspaceId}/inbox?status=${statusFilter}`,
      ),
    refetchInterval: 30_000,
  });

  const invalidate = () => inboxQuery.refetch();

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; data: Record<string, string> }) =>
      api.patch(`/api/app/workspaces/${workspaceId}/inbox/messages/${input.id}`, input.data),
    onSuccess: invalidate,
  });

  const replyMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/app/workspaces/${workspaceId}/inbox/messages/${id}/reply`, {
        body: replyBody,
      }),
    onSuccess: () => {
      setReplyingTo(null);
      setReplyBody("");
      invalidate();
    },
  });

  return (
    <div>
      <h1 {...stylex.props(styles.title)}>Inbox</h1>

      <div {...stylex.props(styles.filters)}>
        {STATUS_FILTERS.map((status) => (
          <Button
            key={status}
            variant={statusFilter === status ? "primary" : "outline"}
            onClick={() => setStatusFilter(status)}
          >
            {status.toLowerCase()}
          </Button>
        ))}
        <Button variant="ghost" onClick={invalidate}>↻</Button>
      </div>

      <div {...stylex.props(styles.list)}>
        {(inboxQuery.data?.results ?? []).map((message) => (
          <Card key={message.id}>
            <div {...stylex.props(styles.messageHeader)}>
              <span {...stylex.props(styles.sender)}>{message.senderName}</span>
              <span {...stylex.props(styles.meta)}>
                @{message.senderHandle || "—"} · {message.socialAccount.platform} ·{" "}
                {new Date(message.createdAt).toLocaleString()}
              </span>
              <span {...stylex.props(styles.badge, message.status === "UNREAD" && styles.badgeUnread)}>
                {message.messageType.toLowerCase()}
              </span>
              {message.sentiment === "NEGATIVE" && (
                <span {...stylex.props(styles.badge, styles.badgeNegative)}>negative</span>
              )}
            </div>

            <div {...stylex.props(styles.body)}>{message.body || "(no text)"}</div>

            <div {...stylex.props(styles.actions)}>
              <Button
                variant="outline"
                onClick={() => setReplyingTo(replyingTo === message.id ? null : message.id)}
              >
                Reply
              </Button>
              {message.status !== "RESOLVED" && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    updateMutation.mutate({ id: message.id, data: { status: "RESOLVED" } })
                  }
                >
                  Resolve
                </Button>
              )}
              {message.status === "UNREAD" && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    updateMutation.mutate({ id: message.id, data: { status: "OPEN" } })
                  }
                >
                  Mark read
                </Button>
              )}
            </div>

            {replyingTo === message.id && (
              <form
                {...stylex.props(styles.replyForm)}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (replyBody.trim()) replyMutation.mutate(message.id);
                }}
              >
                <textarea
                  {...stylex.props(styles.input)}
                  placeholder={`Reply as ${message.socialAccount.accountName}…`}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={3}
                />
                <div {...stylex.props(styles.replyRow)}>
                  <Button type="submit" disabled={replyMutation.isPending || !replyBody.trim()}>
                    Send reply
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setReplyingTo(null)}>
                    Cancel
                  </Button>
                </div>
                {replyMutation.isError && (
                  <span style={{ color: colors.destructive, fontSize: fontSizes.xs }}>
                    Replies are not supported on this platform.
                  </span>
                )}
              </form>
            )}
          </Card>
        ))}

        {(inboxQuery.data?.results.length ?? 0) === 0 && !inboxQuery.isLoading && (
          <Card>No {statusFilter.toLowerCase()} messages. 🎉</Card>
        )}
      </div>
    </div>
  );
}
