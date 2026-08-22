import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

export const Route = createFileRoute("/_app/onboarding")({
  component: OnboardingPage,
});

const styles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[6],
    minHeight: "60vh",
  },
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, color: colors.foreground },
  hint: { color: colors.mutedForeground, fontSize: fontSizes.sm },
  form: { display: "flex", gap: spacing[3] },
  input: {
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: spacing[1],
    minWidth: 280,
  },
});

function OnboardingPage() {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");

  const createOrg = useMutation({
    mutationFn: () => api.post<{ id: string }>("/api/app/organizations", { name: orgName }),
    onSuccess: async (org) => {
      await navigate({ to: "/organizations/$orgId/workspaces", params: { orgId: org.id } });
    },
  });

  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>Create your first organization</h1>
      <p {...stylex.props(styles.hint)}>
        An organization holds workspaces, channels and team members.
      </p>
      <Card>
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();
            if (orgName.trim()) createOrg.mutate();
          }}
        >
          <input
            {...stylex.props(styles.input)}
            placeholder="Organization name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
          <Button type="submit" disabled={!orgName.trim() || createOrg.isPending}>
            Create
          </Button>
        </form>
        {createOrg.isError && (
          <p style={{ color: colors.destructive, marginTop: spacing[3], fontSize: fontSizes.sm }}>
            Could not create the organization — try again.
          </p>
        )}
      </Card>
    </div>
  );
}
