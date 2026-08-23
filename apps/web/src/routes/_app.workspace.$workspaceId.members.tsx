import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface MemberRow {
  orgRole: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
    isActive: boolean;
  };
}

interface InvitationRow {
  id: string;
  email: string;
  orgRole: string;
  expiresAt: string;
  createdAt: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
}

export const Route = createFileRoute("/_app/workspace/$workspaceId/members")({
  component: MembersPage,
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
    marginBlock: spacing[5],
    color: colors.foreground,
  },
  list: { display: "flex", flexDirection: "column", gap: spacing[3] },
  memberCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    flexWrap: "wrap" as const,
  },
  memberInfo: { display: "flex", flexDirection: "column", gap: 2 },
  email: { fontSize: fontSizes.sm, color: colors.foreground, fontWeight: 500 },
  meta: { fontSize: fontSizes.xs, color: colors.mutedForeground },
  roleBadge: {
    fontSize: fontSizes.xs,
    padding: "2px 8px",
    borderRadius: 9999,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.muted,
    color: colors.mutedForeground,
  },
  inviteForm: {
    display: "flex",
    flexDirection: "column",
    gap: spacing[3],
    marginBottom: spacing[6],
  },
  formRow: { display: "flex", gap: spacing[3], alignItems: "center", flexWrap: "wrap" as const },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    flex: 1,
    minWidth: 220,
    fontSize: fontSizes.sm,
  },
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
});

function MembersPage() {
  const { workspaceId } = Route.useParams();
  const queryClient = useQueryClient();

  // Resolve org from workspace.
  const wsQuery = useQuery({
    queryKey: ["workspace-org", workspaceId],
    queryFn: () =>
      api.get<{ results: Array<{ id: string; organizationId?: string }> }>(
        `/api/app/organizations`,
      ).then(async (orgs) => {
        for (const org of orgs.results) {
          const wss = await api.get<{ results: Array<{ id: string }> }>(
            `/api/app/organizations/${org.id}/workspaces`,
          );
          if (wss.results.some((w) => w.id === workspaceId)) {
            return { orgId: org.id };
          }
        }
        throw new Error("Workspace not found");
      }),
  });

  const orgId = wsQuery.data?.orgId ?? "";

  const membersQuery = useQuery({
    queryKey: ["members", orgId],
    queryFn: () =>
      api.get<{ results: MemberRow[] }>(`/api/app/organizations/${orgId}/members`),
    enabled: Boolean(orgId),
  });

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", orgId],
    queryFn: () =>
      api.get<{ results: WorkspaceRow[] }>(
        `/api/app/organizations/${orgId}/workspaces`,
      ),
    enabled: Boolean(orgId),
  });

  const invitationsQuery = useQuery({
    queryKey: ["invitations", orgId],
    queryFn: () =>
      api.get<{ results: InvitationRow[] }>(
        `/api/app/organizations/${orgId}/members/invitations`,
      ),
    enabled: Boolean(orgId),
  });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");

  const inviteMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/app/organizations/${orgId}/members/invitations`, {
        email: inviteEmail,
        orgRole: inviteRole,
        workspaceRoles: {},
      }),
    onSuccess: () => {
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["invitations", orgId] });
    },
  });

  const myRole =
    membersQuery.data?.results.find((m) => m.orgRole === "owner") !== undefined
      ? "owner"
      : "admin";

  return (
    <div>
      <h1 {...stylex.props(styles.title)}>Team members</h1>

      {/* Invite form */}
      {(myRole === "owner" || myRole === "admin") && (
        <Card>
          <form
            {...stylex.props(styles.inviteForm)}
            onSubmit={(event) => {
              event.preventDefault();
              if (inviteEmail.trim()) inviteMutation.mutate();
            }}
          >
            <div {...stylex.props(styles.formRow)}>
              <input
                {...stylex.props(styles.input)}
                type="email"
                placeholder="email@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
              <select
                {...stylex.props(styles.select)}
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as "member" | "admin")
                }
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <Button type="submit" disabled={inviteMutation.isPending}>
                Send invitation
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Pending invitations */}
      {(invitationsQuery.data?.results.length ?? 0) > 0 && (
        <>
          <h2 {...stylex.props(styles.sectionTitle)}>
            Pending invitations ({invitationsQuery.data?.results.length})
          </h2>
          <div {...stylex.props(styles.list)}>
            {(invitationsQuery.data?.results ?? []).map((inv) => (
              <Card key={inv.id}>
                <div {...stylex.props(styles.memberCard)}>
                  <span {...stylex.props(styles.email)}>{inv.email}</span>
                  <span {...stylex.props(styles.roleBadge)}>
                    {inv.orgRole} · expires{" "}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Active members */}
      <h2 {...stylex.props(styles.sectionTitle)}>Members</h2>
      <div {...stylex.props(styles.list)}>
        {(membersQuery.data?.results ?? []).map((m) => (
          <Card key={m.user.id}>
            <div {...stylex.props(styles.memberCard)}>
              <div {...stylex.props(styles.memberInfo)}>
                <span {...stylex.props(styles.email)}>{m.user.email}</span>
                <span {...stylex.props(styles.meta)}>
                  {m.user.displayName || m.user.email} ·{" "}
                  {new Date(m.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: spacing[3] }}>
                <span {...stylex.props(styles.roleBadge)}>{m.orgRole}</span>
                {myRole === "owner" && m.orgRole !== "owner" && (
                  <Button variant="ghost">Remove</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Workspaces overview */}
      <h2 {...stylex.props(styles.sectionTitle)}>Workspaces in this org</h2>
      <div {...stylex.props(styles.list)}>
        {(workspacesQuery.data?.results ?? []).map((ws) => (
          <Card key={ws.id}>
            <div {...stylex.props(styles.memberCard)}>
              <span {...stylex.props(styles.email)}>{ws.name}</span>
              <a href={`/workspace/${ws.id}/calendar`} style={{ fontSize: fontSizes.sm, color: colors.primary, textDecoration: "none" }}>
                Open →
              </a>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
