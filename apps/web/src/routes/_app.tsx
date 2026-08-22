import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";

import { queryClient } from "~/lib/query-client";
import { sessionQuery } from "~/features/auth/session";
import { colors, spacing } from "../styles/tokens.stylex";
import { AppSidebar } from "~/components/layout/app-sidebar";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    try {
      await queryClient.ensureQueryData(sessionQuery());
    } catch {
      throw redirect({
        to: "/accounts/login",
        search: { redirect: location.href },
      });
    }
  },
  component: AppLayout,
});

const styles = stylex.create({
  layout: {
    display: "flex",
    minHeight: "100vh",
    backgroundColor: colors.background,
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  main: {
    flex: 1,
    padding: spacing[6],
    minWidth: 0,
  },
});

function AppLayout() {
  const session = queryClient.getQueryData(sessionQuery().queryKey);
  const activeOrg =
    session?.orgMemberships[0]?.organization ?? null;

  return (
    <div {...stylex.props(styles.layout)}>
      <AppSidebar orgName={activeOrg?.name} />
      <main {...stylex.props(styles.main)}>
        <Outlet />
      </main>
    </div>
  );
}
