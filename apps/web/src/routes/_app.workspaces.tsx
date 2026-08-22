import { createFileRoute, redirect } from "@tanstack/react-router";

import { queryClient } from "~/lib/query-client";
import { sessionQuery } from "~/features/auth/session";

export const Route = createFileRoute("/_app/workspaces")({
  beforeLoad: async () => {
    const session = await queryClient.ensureQueryData(sessionQuery());
    const firstOrg = session?.orgMemberships[0]?.organizationId;
    if (firstOrg) {
      throw redirect({ to: "/organizations/$orgId/workspaces", params: { orgId: firstOrg } });
    }
    throw redirect({ to: "/onboarding" });
  },
  component: () => null,
});
