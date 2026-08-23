import { createFileRoute, Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
}

export const Route = createFileRoute("/_app/organizations/$orgId/workspaces")({
  component: WorkspacesPage,
});

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[6],
  },
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, color: colors.foreground },
  list: { display: "flex", flexDirection: "column", gap: spacing[3] },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing[4],
    textDecoration: "none",
    color: colors.foreground,
    ":hover": { borderColor: colors.primary },
  },
  name: { fontWeight: 600 },
  createForm: {
    display: "flex",
    gap: spacing[3],
    marginTop: spacing[6],
  },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    flex: 1,
  },
});

function WorkspacesPage() {
  const { orgId } = Route.useParams();
  const [newName, setNewName] = useState("");

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", orgId],
    queryFn: () => api.get<{ results: WorkspaceRow[] }>(`/api/app/organizations/${orgId}/workspaces`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/app/organizations/${orgId}/workspaces`, { name: newName }),
    onSuccess: () => workspacesQuery.refetch(),
  });

  return (
    <div>
      <div {...stylex.props(styles.header)}>
        <h1 {...stylex.props(styles.title)}>Workspaces</h1>
      </div>

      {workspacesQuery.data && (
        <div {...stylex.props(styles.list)}>
          {workspacesQuery.data.results.map((ws) => (
            <Link
              key={ws.id}
              to="/workspace/$workspaceId/calendar"
              params={{ workspaceId: ws.id }}
              {...stylex.props(styles.row, cardStyle.default)}
            >
              <span {...stylex.props(styles.name)}>{ws.name}</span>
              <Button variant="ghost">Open →</Button>
            </Link>
          ))}
        </div>
      )}

      <Card>
        <form
          {...stylex.props(styles.createForm)}
          onSubmit={(event) => {
            event.preventDefault();
            if (newName.trim()) createMutation.mutate();
          }}
        >
          <input
            {...stylex.props(styles.input)}
            placeholder="New workspace name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button type="submit" disabled={!newName.trim() || createMutation.isPending}>
            Create workspace
          </Button>
        </form>
      </Card>
    </div>
  );
}

const cardStyle = stylex.create({
  default: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
  },
});
