import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface AccountRow {
  id: string;
  platform: string;
  accountName: string;
}

interface TargetOverride {
  socialAccountId: string;
  caption: string | null;
  title: string | null;
  firstComment: string | null;
}

export const Route = createFileRoute("/_app/workspace/$workspaceId/composer")({
  component: ComposerPage,
});

const styles = stylex.create({
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, marginBottom: spacing[6], color: colors.foreground },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 320px",
    gap: spacing[6],
    alignItems: "start",
  },
  form: { display: "flex", flexDirection: "column", gap: spacing[4] },
  label: { display: "flex", flexDirection: "column", gap: spacing[1], fontSize: fontSizes.sm, color: colors.foreground },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    fontFamily: "inherit",
    ":focus": { outlineStyle: "solid", outlineWidth: 2, outlineColor: colors.primary },
  },
  textarea: { minHeight: 120, resize: "vertical" },
  sectionLabel: { fontWeight: 600, fontSize: fontSizes.sm },
  accountList: { display: "flex", flexDirection: "column", gap: spacing[2] },
  accountRow: { display: "flex", alignItems: "center", gap: spacing[2], fontSize: fontSizes.sm },
  overrideBox: {
    marginTop: spacing[2],
    padding: spacing[3],
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: spacing[1],
    display: "flex",
    flexDirection: "column",
    gap: spacing[2],
  },
  overrideCaption: { fontSize: fontSizes.xs, color: colors.mutedForeground },
});

function ComposerPage() {
  const { workspaceId } = Route.useParams();

  const accountsQuery = useQuery({
    queryKey: ["social-accounts", workspaceId],
    queryFn: () =>
      api.get<{ results: AccountRow[] }>(`/api/app/workspaces/${workspaceId}/social-accounts`),
  });

  // Base content
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, TargetOverride>>({});
  const [scheduledAt, setScheduledAt] = useState("");

  const toggleAccount = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/app/workspaces/${workspaceId}/posts`, {
        title,
        caption,
        firstComment,
        internalNotes,
        tags: [],
        scheduledAt: scheduledAt || null,
        targets: selectedIds.map((id) => ({
          socialAccountId: id,
          caption: overrides[id]?.caption || null,
          title: overrides[id]?.title || null,
          firstComment: overrides[id]?.firstComment || null,
        })),
      }),
  });

  const scheduleMutation = useMutation({
    mutationFn: (postId: string) =>
      api.post(`/api/app/workspaces/${workspaceId}/posts/${postId}/schedule`, {
        scheduledAt: new Date(scheduledAt).toISOString(),
      }),
  });

  const createAndSchedule = useMutation({
    mutationFn: async () => {
      const created = await createMutation.mutateAsync();
      if (scheduledAt && !createAndScheduleFailed(created)) {
        await scheduleMutation.mutateAsync((created as { id: string }).id);
      }
      return created;
    },
  });

  function createAndScheduleFailed(_r: unknown): boolean {
    return false;
  }

  const saving = createMutation.isPending || createAndSchedule.isPending;
  const errorText =
    createMutation.error instanceof Error
      ? createMutation.error.message.slice(0, 200)
      : null;

  return (
    <div>
      <h1 {...stylex.props(styles.title)}>New post</h1>

      <div {...stylex.props(styles.grid)}>
        <Card>
          <form
            {...stylex.props(styles.form)}
            onSubmit={(event) => {
              event.preventDefault();
              if (scheduledAt) createAndSchedule.mutate();
              else createMutation.mutate();
            }}
          >
            <label {...stylex.props(styles.label)}>
              Title
              <input {...stylex.props(styles.input)} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>

            <label {...stylex.props(styles.label)}>
              Caption
              <textarea
                {...stylex.props(styles.input, styles.textarea)}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </label>

            <label {...stylex.props(styles.label)}>
              First comment
              <input {...stylex.props(styles.input)} value={firstComment} onChange={(e) => setFirstComment(e.target.value)} />
            </label>

            <label {...stylex.props(styles.label)}>
              Internal notes
              <input {...stylex.props(styles.input)} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
            </label>

            {errorText && (
              <p style={{ color: colors.destructive, fontSize: fontSizes.sm }}>{errorText}</p>
            )}

            {(createMutation.isSuccess || createAndSchedule.isSuccess) && (
              <p style={{ color: colors.success, fontSize: fontSizes.sm }}>
                Post saved{scheduleMutation.isSuccess || scheduledAt ? " and scheduled" : ""}.
              </p>
            )}

            <label {...stylex.props(styles.label)}>
              Schedule for
              <input
                {...stylex.props(styles.input)}
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>

            <div style={{ display: "flex", gap: spacing[3] }}>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save draft"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  if (!scheduledAt) return;
                  createAndSchedule.mutate();
                }}
              >
                Save &amp; schedule
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <div {...stylex.props(styles.sectionLabel)}>Target accounts</div>
          <div {...stylex.props(styles.accountList)}>
            {(accountsQuery.data?.results ?? []).map((account) => (
              <div key={account.id} {...stylex.props(styles.accountRow)}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(account.id)}
                  onChange={() => toggleAccount(account.id)}
                />
                <span>
                  <strong>{account.platform}</strong> · {account.accountName}
                </span>
              </div>
            ))}
          </div>

          {accountsQuery.data?.results.length === 0 && (
            <p style={{ fontSize: fontSizes.sm, color: colors.mutedForeground }}>
              No connected channels yet — connect one in Channels.
            </p>
          )}

          {selectedIds.map((id) => {
            const account = accountsQuery.data?.results.find((a) => a.id === id);
            const override = overrides[id];
            const showOverride = override !== undefined;
            return (
              <div key={id} {...stylex.props(styles.overrideBox)}>
                <div {...stylex.props(styles.overrideCaption)}>
                  Override · {account?.platform} ({account?.accountName})
                  {" — "}
                  <a
                    href="#remove"
                    onClick={(e) => {
                      e.preventDefault();
                      setOverrides((prev) => {
                        const next = { ...prev };
                        delete next[id];
                        return next;
                      });
                    }}
                  >
                    remove override
                  </a>
                </div>
                <input
                  {...stylex.props(styles.input)}
                  placeholder="Platform-specific title"
                  value={override?.title ?? ""}
                  onChange={(e) =>
                    setOverrides((prev) => ({
                      ...prev,
                      [id]: { ...(prev[id] ?? blankOverride(id)), title: e.target.value },
                    }))
                  }
                />
                <textarea
                  {...stylex.props(styles.input)}
                  placeholder="Platform-specific caption"
                  value={override?.caption ?? ""}
                  onChange={(e) =>
                    setOverrides((prev) => ({
                      ...prev,
                      [id]: { ...(prev[id] ?? blankOverride(id)), caption: e.target.value },
                    }))
                  }
                />
                {!showOverride && null}
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

function blankOverride(socialAccountId: string): TargetOverride {
  return { socialAccountId, caption: "", title: "", firstComment: "" };
}
