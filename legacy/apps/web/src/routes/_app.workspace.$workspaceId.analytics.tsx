import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { api } from "~/lib/api";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface AccountRow {
  id: string;
  platform: string;
  accountName: string;
}

interface AccountAnalytics {
  account_id: string;
  window_days: number;
  kpis: {
    followers_latest: number | null;
    reach_total: number;
    impressions_total: number;
    views_total: number;
    engagements_total: number;
  };
  series: Array<{
    date: string;
    followers: number | null;
    follower_delta: number | null;
    reach: number | null;
    impressions: number | null;
    views: number | null;
    engagements: number | null;
  }>;
}

interface PostsTableRow {
  post_id: string;
  title: string;
  created_at: string;
  published_at: string | null;
  scheduled_at: string | null;
  views: number;
  engagements: number;
}

const WINDOWS = [7, 30, 90] as const;

export const Route = createFileRoute("/_app/workspace/$workspaceId/analytics")({
  component: AnalyticsPage,
});

const styles = stylex.create({
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, marginBottom: spacing[4], color: colors.foreground },
  controls: { display: "flex", gap: spacing[2], marginBottom: spacing[6], alignItems: "center" },
  select: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    backgroundColor: colors.surface,
    fontSize: fontSizes.sm,
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: spacing[4],
    marginBottom: spacing[6],
  },
  kpiValue: { fontSize: fontSizes["2xl"], fontWeight: 700, color: colors.foreground },
  kpiLabel: { fontSize: fontSizes.xs, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.mutedForeground },
  chart: { marginBottom: spacing[6] },
  bars: { display: "flex", alignItems: "flex-end", gap: 2, height: 120 },
  bar: { flex: 1, backgroundColor: colors.primary, borderRadius: "2px 2px 0 0", minWidth: 3 },
  sectionTitle: { fontSize: fontSizes.lg, fontWeight: 600, marginBlock: spacing[6], color: colors.foreground },
  table: { width: "100%", borderCollapse: "collapse", fontSize: fontSizes.sm },
  th: {
    textAlign: "left",
    padding: spacing[2],
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    cursor: "pointer",
    color: colors.mutedForeground,
    fontWeight: 600,
  },
  td: {
    padding: spacing[2],
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.muted,
  },
  empty: { color: colors.mutedForeground, fontSize: fontSizes.sm },
});

function AnalyticsPage() {
  const { workspaceId } = Route.useParams();
  const [windowDays, setWindowDays] = useState<number>(30);
  const [sort, setSort] = useState<"views" | "engagements" | "date">("date");

  const accountsQuery = useQuery({
    queryKey: ["social-accounts", workspaceId],
    queryFn: () => api.get<{ results: AccountRow[] }>(`/api/app/workspaces/${workspaceId}/social-accounts`),
  });

  const [accountId, setAccountId] = useState<string | null>(null);
  const effectiveAccountId = accountId ?? accountsQuery.data?.results[0]?.id ?? null;

  const analyticsQuery = useQuery({
    queryKey: ["analytics-account", effectiveAccountId, windowDays],
    queryFn: () =>
      api.get<AccountAnalytics>(
        `/api/app/workspaces/${workspaceId}/analytics/accounts/${effectiveAccountId}?days=${windowDays}`,
      ),
    enabled: effectiveAccountId !== null,
  });

  const postsQuery = useQuery({
    queryKey: ["analytics-posts-table", workspaceId, sort],
    queryFn: () =>
      api.get<{ results: PostsTableRow[] }>(
        `/api/app/workspaces/${workspaceId}/analytics/posts?sort=${sort}`,
      ),
  });

  const series = analyticsQuery.data?.series ?? [];
  const maxReach = useMemo(
    () => Math.max(1, ...series.map((s) => s.reach ?? 0)),
    [series],
  );

  return (
    <div>
      <h1 {...stylex.props(styles.title)}>Analytics</h1>

      <div {...stylex.props(styles.controls)}>
        <select
          {...stylex.props(styles.select)}
          value={effectiveAccountId ?? ""}
          onChange={(e) => setAccountId(e.target.value || null)}
        >
          {(accountsQuery.data?.results ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.platform} · {a.accountName}
            </option>
          ))}
        </select>

        {WINDOWS.map((days) => (
          <Button
            key={days}
            variant={windowDays === days ? "primary" : "outline"}
            onClick={() => setWindowDays(days)}
          >
            {days}d
          </Button>
        ))}
      </div>

      {analyticsQuery.data && (
        <>
          <div {...stylex.props(styles.kpiGrid)}>
            <Kpi label="Followers" value={analyticsQuery.data.kpis.followers_latest} />
            <Kpi label="Reach" value={analyticsQuery.data.kpis.reach_total} />
            <Kpi label="Impressions" value={analyticsQuery.data.kpis.impressions_total} />
            <Kpi label="Views" value={analyticsQuery.data.kpis.views_total} />
            <Kpi label="Engagements" value={analyticsQuery.data.kpis.engagements_total} />
          </div>

          {series.length > 0 && (
            <Card>
              <div {...stylex.props(styles.sectionTitle)}>Reach trend ({windowDays}d)</div>
              <div {...stylex.props(styles.bars)}>
                {series.map((point) => (
                  <div
                    key={point.date}
                    {...stylex.props(styles.bar)}
                    title={`${point.date}: ${point.reach ?? 0}`}
                    style={{ height: `${Math.round(((point.reach ?? 0) / maxReach) * 100)}%` }}
                  />
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {analyticsQuery.isError && (
        <p {...stylex.props(styles.empty)}>
          Select an account with collected analytics data.
        </p>
      )}

      <h2 {...stylex.props(styles.sectionTitle)}>All posts</h2>
      {postsQuery.data && postsQuery.data.results.length > 0 ? (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.th)} onClick={() => setSort("date")}>Post</th>
              <th {...stylex.props(styles.th)} onClick={() => setSort("views")}>Views</th>
              <th {...stylex.props(styles.th)} onClick={() => setSort("engagements")}>Engagements</th>
              <th {...stylex.props(styles.th)}>Published</th>
            </tr>
          </thead>
          <tbody>
            {postsQuery.data.results.map((row) => (
              <tr key={row.post_id}>
                <td {...stylex.props(styles.td)}>
                  {row.title || row.post_id.slice(0, 8)}
                </td>
                <td {...stylex.props(styles.td)}>{row.views.toLocaleString()}</td>
                <td {...stylex.props(styles.td)}>{row.engagements.toLocaleString()}</td>
                <td {...stylex.props(styles.td)}>
                  {row.published_at
                    ? new Date(row.published_at).toLocaleDateString()
                    : row.scheduled_at
                      ? `scheduled ${new Date(row.scheduled_at).toLocaleDateString()}`
                      : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p {...stylex.props(styles.empty)}>No posts with metrics yet.</p>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | null }) {
  return (
    <Card>
      <div {...stylex.props(styles.kpiLabel)}>{label}</div>
      <div {...stylex.props(styles.kpiValue)}>
        {value === null ? "—" : value.toLocaleString()}
      </div>
    </Card>
  );
}

function Button(props: React.ComponentProps<"button"> & { variant?: "primary" | "outline" }) {
  return <button type="button" {...props} />;
}
