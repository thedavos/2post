import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "~/lib/api";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface Preference {
  id: string;
  eventType: string;
  inApp: boolean;
  email: boolean;
  webhook: boolean;
}

const EVENT_TYPES = [
  "post.published",
  "post.failed",
  "approval.requested",
  "approval.completed",
  "inbox.new_message",
  "account.token_expiring",
  "account.health_error",
] as const;

export const Route = createFileRoute("/_app/workspace/$workspaceId/settings")({
  component: WorkspaceSettingsPage,
});

const styles = stylex.create({
  title: {
    fontSize: fontSizes["2xl"],
    fontWeight: 700,
    marginBottom: spacing[6],
    color: colors.foreground,
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: 600,
    marginBlock: spacing[6],
    color: colors.foreground,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: fontSizes.sm },
  th: {
    textAlign: "left",
    padding: spacing[2],
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    color: colors.mutedForeground,
  },
  td: {
    padding: spacing[2],
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.muted,
  },
  checkbox: { accentColor: colors.primary },
  hint: { fontSize: fontSizes.xs, color: colors.mutedForeground, marginBottom: spacing[4] },
});

function WorkspaceSettingsPage() {
  const prefsQuery = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () =>
      api.get<{ results: Preference[] }>("/api/app/notifications/preferences"),
  });

  const toggle = useMutation({
    mutationFn: (input: { eventType: string; channel: string; value: boolean }) =>
      api.patch("/api/app/notifications/preferences", input),
    onSuccess: () => prefsQuery.refetch(),
  });

  const prefsByEvent = new Map<string, Preference>();
  for (const p of prefsQuery.data?.results ?? []) prefsByEvent.set(p.eventType, p);

  return (
    <div>
      <h1 {...stylex.props(styles.title)}>Settings</h1>

      <h2 {...stylex.props(styles.sectionTitle)}>Notification preferences</h2>
      <p {...stylex.props(styles.hint)}>
        Choose which channels receive each event type. Changes apply immediately.
      </p>
      <Card>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.th)}>Event</th>
              <th {...stylex.props(styles.th)}>In-app</th>
              <th {...stylex.props(styles.th)}>Email</th>
              <th {...stylex.props(styles.th)}>Webhook</th>
            </tr>
          </thead>
          <tbody>
            {(prefsQuery.data?.results ?? []).map((p) => (
              <tr key={p.id}>
                <td {...stylex.props(styles.td)}>{p.eventType}</td>
                {(["inApp", "email", "webhook"] as const).map((channel) => (
                  <td key={channel} {...stylex.props(styles.td)}>
                    <input
                      type="checkbox"
                      {...stylex.props(styles.checkbox)}
                      checked={p[channel]}
                      onChange={(e) =>
                        toggle.mutate({
                          eventType: p.eventType,
                          channel,
                          value: e.target.checked,
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
            {/* Show rows for known event types that don't have prefs yet */}
            {EVENT_TYPES.filter((et) => !prefsByEvent.has(et)).map((et) => (
              <tr key={et}>
                <td {...stylex.props(styles.td)}>
                  {et}
                  {" — default"}
                </td>
                {[0, 1, 2].map((i) => (
                  <td key={i} {...stylex.props(styles.td)}>—</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <h2 {...stylex.props(styles.sectionTitle)}>Workspace</h2>
      <p {...stylex.props(styles.hint)}>
        Branding and defaults are managed via the workspace PATCH endpoint
        (PATCH /api/app/workspaces/:id with branding/defaults JSON).
      </p>
    </div>
  );
}
