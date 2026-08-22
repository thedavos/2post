import { createFileRoute, redirect } from "@tanstack/react-router";

import { queryClient } from "~/lib/query-client";
import { sessionQuery } from "~/features/auth/session";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    let session;
    try {
      session = await queryClient.ensureQueryData(sessionQuery());
    } catch {
      throw redirect({ to: "/accounts/login", search: { redirect: undefined } });
    }

    // Land on the first organization's workspace list (legacy default-org behavior).
    const firstOrg = session?.orgMemberships[0]?.organizationId;
    if (firstOrg) {
      throw redirect({
        to: "/organizations/$orgId/workspaces",
        params: { orgId: firstOrg },
      });
    }
    throw redirect({ to: "/onboarding" });
  },
  component: () => null,
});
