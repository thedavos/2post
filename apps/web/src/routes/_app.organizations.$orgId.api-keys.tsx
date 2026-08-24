import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface KeyRow {
  id: string;
  name: string;
  workspaceId: string;
  lookupPrefix: string;
  permissions: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

const ALL_PERMISSIONS = [
  { key: "create_posts", label: "Create posts" },
  { key: "publish_directly", label: "Publish directly" },
  { key: "upload_media", label: "Upload media" },
  { key: "view_analytics", label: "View analytics" },
] as const;

export const Route = createFileRoute("/_app/organizations/$orgId/api-keys")({
  component: ApiKeysPage,
});

const styles = stylex.create({
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, marginBottom: spacing[4], color: colors.foreground },
  hint: { color: colors.mutedForeground, fontSize: fontSizes.sm, marginBottom: spacing[6] },
  form: { display: "flex", flexDirection: "column", gap: spacing[3], marginBottom: spacing[6] },
  row: { display: "flex", gap: spacing[3], alignItems: "center" },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    fontSize: fontSizes.sm,
    flex: 1,
  },
  perms: { display: "flex", flexWrap: "wrap", gap: spacing[4], fontSize: fontSizes.sm },
  permItem: { display: "flex", gap: spacing[1], alignItems: "center" },
  tokenBox: {
    marginTop: spacing[4],
    padding: spacing[4],
    backgroundColor: "#fefce8",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.warning,
    borderRadius: spacing[2],
    wordBreak: "break-all",
    fontFamily: "ui-monospace, monospace",
    fontSize: fontSizes.sm,
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
  td: { padding: spacing[2], borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: colors.muted },
});

function ApiKeysPage() {
  const { orgId } = Route.useParams();
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [permissions, setPermissions] = useState<string[]>(["create_posts"]);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["api-keys", orgId],
    queryFn: () => api.get<{ results: KeyRow[] }>(`/api/app/organizations/${orgId}/api-keys`),
  });

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", orgId],
    queryFn: () =>
      api.get<{ results: Array<{ id: string; name: string }> }>(
        `/api/app/organizations/${orgId}/workspaces`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string; token: string }>(`/api/app/organizations/${orgId}/api-keys`, {
        workspaceId,
        name,
        permissions,
      }),
    onSuccess: (result) => {
      setFreshToken(result.token);
      setName("");
      keysQuery.refetch();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) =>
      api.delete(`/api/app/organizations/${orgId}/api-keys/${keyId}`),
    onSuccess: () => keysQuery.refetch(),
  });

  return (
    <div>
      <h1 {...stylex.props(styles.title)}>Agent API Keys</h1>
      <p {...stylex.props(styles.hint)}>
        Scoped bearer credentials for AI agents and integrations
        (<code>Authorization: Bearer bb_studio_…</code>). The full token is shown once.
      </p>

      <Card>
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();
            if (name && workspaceId) createMutation.mutate();
          }}
        >
          <div {...stylex.props(styles.row)}>
            <input
              {...stylex.props(styles.input)}
              placeholder="Key name (e.g. Claude Code)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select
              {...stylex.props(styles.input)}
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              <option value="">Select workspace…</option>
              {(workspacesQuery.data?.results ?? []).map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
          <div {...stylex.props(styles.perms)}>
            {ALL_PERMISSIONS.map((perm) => (
              <label key={perm.key} {...stylex.props(styles.permItem)}>
                <input
                  type="checkbox"
                  checked={permissions.includes(perm.key)}
                  onChange={(e) =>
                    setPermissions((prev) =>
                      e.target.checked ? [...prev, perm.key] : prev.filter((p) => p !== perm.key),
                    )
                  }
                />
                {perm.label}
              </label>
            ))}
          </div>
          <Button type="submit" disabled={!name || !workspaceId || createMutation.isPending}>
            Generate key
          </Button>
        </form>

        {freshToken && (
          <div {...stylex.props(styles.tokenBox)}>
            <strong>Copy this now — it will not be shown again:</strong>
            <br />
            {freshToken}
          </div>
        )}
      </Card>

      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            <th {...stylex.props(styles.th)}>Name</th>
            <th {...stylex.props(styles.th)}>Prefix</th>
            <th {...stylex.props(styles.th)}>Permissions</th>
            <th {...stylex.props(styles.th)}>Last used</th>
            <th {...stylex.props(styles.th)}></th>
          </tr>
        </thead>
        <tbody>
          {(keysQuery.data?.results ?? []).map((key) => (
            <tr key={key.id}>
              <td {...stylex.props(styles.td)}>{key.name}</td>
              <td {...stylex.props(styles.td)}>
                bb_studio_…_{key.lookupPrefix}
              </td>
              <td {...stylex.props(styles.td)}>{key.permissions.join(", ") || "—"}</td>
              <td {...stylex.props(styles.td)}>
                {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "never"}
              </td>
              <td {...stylex.props(styles.td)}>
                <Button variant="ghost" onClick={() => revokeMutation.mutate(key.id)}>
                  Revoke
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
