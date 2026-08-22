import { createFileRoute, redirect } from "@tanstack/react-router";

import { queryClient } from "~/lib/query-client";
import { sessionQuery } from "~/features/auth/session";

export const Route = createFileRoute("/_app/workspaces")({
  beforeLoad: async () => {
    if (import.meta.env.SSR) return; // client-side guard (SSR cookie leakage)
    const session = await queryClient.ensureQueryData(sessionQuery());
    const firstOrg = session?.orgMemberships[0]?.organizationId;
    if (firstOrg) {
      throw redirect({ to: "/organizations/$orgId/workspaces", params: { orgId: firstOrg } });
    }
    throw redirect({ to: "/onboarding" });
  },
  component: () => null,
});
