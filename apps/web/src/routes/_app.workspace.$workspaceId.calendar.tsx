import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { api } from "~/lib/api";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface PostRow {
  id: string;
  title: string;
  caption: string;
  status: string;
  scheduledAt: string | null;
  platformPosts: Array<{ status: string }>;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const Route = createFileRoute("/_app/workspace/$workspaceId/calendar")({
  component: CalendarPage,
});

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[6],
  },
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, color: colors.foreground },
  monthNav: { display: "flex", gap: spacing[2], alignItems: "center" },
  monthLabel: { fontSize: fontSizes.lg, fontWeight: 600, minWidth: 160, textAlign: "center", color: colors.foreground },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 1,
    backgroundColor: colors.border,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    overflow: "hidden",
  },
  dayHeader: {
    backgroundColor: colors.muted,
    padding: spacing[2],
    fontSize: fontSizes.xs,
    fontWeight: 600,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  dayCell: {
    backgroundColor: colors.surface,
    minHeight: 96,
    padding: spacing[2],
    display: "flex",
    flexDirection: "column",
    gap: spacing[1],
  },
  dayCellOutside: { backgroundColor: colors.background, opacity: 0.5 },
  dayNumber: { fontSize: fontSizes.xs, color: colors.mutedForeground, alignSelf: "flex-end" },
  todayNumber: { fontWeight: 700, color: colors.primary },
  event: {
    fontSize: fontSizes.xs,
    padding: "2px 6px",
    borderRadius: 4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  statusScheduled: { backgroundColor: "#dbeafe", color: "#1e40af" },
  statusPublished: { backgroundColor: "#dcfce7", color: "#166534" },
  statusFailed: { backgroundColor: "#fee2e2", color: "#991b1b" },
  statusDraft: { backgroundColor: colors.muted, color: colors.mutedForeground },
});

function CalendarPage() {
  const { workspaceId } = Route.useParams();
  const [cursor, setCursor] = useState(() => new Date());

  const postsQuery = useQuery({
    queryKey: ["posts", workspaceId],
    queryFn: () => api.get<{ results: PostRow[] }>(`/api/app/workspaces/${workspaceId}/posts`),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, PostRow[]>();
    for (const post of postsQuery.data?.results ?? []) {
      if (!post.scheduledAt) continue;
      const dateKey = new Date(post.scheduledAt).toISOString().slice(0, 10);
      const list = map.get(dateKey) ?? [];
      list.push(post);
      map.set(dateKey, list);
    }
    return map;
  }, [postsQuery.data]);

  const cells = useMemo(() => buildMonthCells(cursor), [cursor]);

  const monthLabel = cursor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div {...stylex.props(styles.header)}>
        <h1 {...stylex.props(styles.title)}>Calendar</h1>
        <div {...stylex.props(styles.monthNav)}>
          <Button variant="outline" onClick={() => shiftMonth(cursor, setCursor, -1)}>←</Button>
          <span {...stylex.props(styles.monthLabel)}>{monthLabel}</span>
          <Button variant="outline" onClick={() => shiftMonth(cursor, setCursor, 1)}>→</Button>
          <Button variant="ghost" onClick={() => setCursor(new Date())}>Today</Button>
        </div>
      </div>

      <div {...stylex.props(styles.grid)}>
        {DAY_LABELS.map((label) => (
          <div key={label} {...stylex.props(styles.dayHeader)}>{label}</div>
        ))}
        {cells.map((cell) => (
          <div
            key={cell.key}
            {...stylex.props(
              styles.dayCell,
              !cell.inMonth && styles.dayCellOutside,
            )}
          >
            <span
              {...stylex.props(
                styles.dayNumber,
                cell.isToday && styles.todayNumber,
              )}
            >
              {cell.dayNumber}
            </span>
            {(byDay.get(cell.key) ?? []).map((post) => (
              <a
                key={post.id}
                href={`/workspace/${workspaceId}/composer?post=${post.id}`}
                {...stylex.props(
                  styles.event,
                  statusStyle(post.status),
                )}
                title={post.title || post.caption}
              >
                {post.title || post.caption.slice(0, 40) || "(untitled)"}
              </a>
            ))}
          </div>
        ))}
      </div>

      <Card>
        <div style={{ fontSize: fontSizes.sm, color: colors.mutedForeground }}>
          Recurring slots and queue auto-assignment UI lands with the next pass —
          the API endpoints (/slots, /queues) are already live.
        </div>
      </Card>

      {postsQuery.isLoading && (
        <div style={{ marginTop: spacing[4], color: colors.mutedForeground }}>
          Loading…
        </div>
      )}
    </div>
  );
}

function Button(props: React.ComponentProps<"button"> & { variant?: "outline" | "ghost" | "primary" }) {
  return <button type="button" {...props} />;
}

function statusStyle(status: string):
  | typeof styles.statusPublished
  | typeof styles.statusScheduled
  | typeof styles.statusFailed
  | typeof styles.statusDraft {
  switch (status.toLowerCase()) {
    case "published":
      return styles.statusPublished;
    case "scheduled":
    case "publishing":
      return styles.statusScheduled;
    case "failed":
      return styles.statusFailed;
    default:
      return styles.statusDraft;
  }
}

function buildMonthCells(cursor: Date) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // Monday-first grid (legacy calendar parity).
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);

  const today = new Date();
  const todayKey = toDateKey(today);

  const cells: Array<{ key: string; dayNumber: number; inMonth: boolean; isToday: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({
      key: toDateKey(d),
      dayNumber: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: toDateKey(d) === todayKey,
    });
  }
  return cells;
}

function shiftMonth(cursor: Date, set: (d: Date) => void, delta: number) {
  set(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
