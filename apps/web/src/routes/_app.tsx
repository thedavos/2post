import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { queryClient } from "~/lib/query-client";
import { sessionQuery } from "~/features/auth/session";
import { useBrandTheme } from "~/lib/brand-theme";
import { colors, spacing } from "../styles/tokens.stylex";
import { AppSidebar } from "~/components/layout/app-sidebar";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    if (import.meta.env.SSR) return; // client-side guard avoids SSR cookie leakage
    try {
      await queryClient.ensureQueryData(sessionQuery());
    } catch {
      throw redirect({
        to: "/accounts/login",
        search: { redirect: location.href, error: undefined },
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
  // Reactive session state — on auth failure navigate after hydration.
  // No early return: hook order must stay stable across auth transitions.
  const { data: session, error } = useQuery(sessionQuery());
  const activeOrg = session?.orgMemberships[0]?.organization ?? null;

  const shouldRedirect = !import.meta.env.SSR && Boolean(error);

  // Hard navigation on auth failure — deterministic regardless of
  // hydration/router state.
  useEffect(() => {
    console.log("[guard] shouldRedirect:", shouldRedirect);
    if (shouldRedirect) {
      window.location.assign(
        "/accounts/login?redirect=" +
          encodeURIComponent(window.location.pathname),
      );
    }
  }, [shouldRedirect]);

  // White-label: branding arrives on the active workspace (GET /workspaces).
  const workspaces = queryClient.getQueriesData<{
    results: Array<{ id: string; branding?: Record<string, string> }>;
  }>({ queryKey: ["workspaces"] });
  const match = workspaces
    .flatMap(([, data]) => data?.results ?? [])
    .find((ws) => typeof window !== "undefined" && window.location.pathname.includes(ws.id));
  useBrandTheme(match?.branding as never);

  return (
    <div {...stylex.props(styles.layout)} data-testid="app-shell">
      <AppSidebar orgName={activeOrg?.name} />
      <main {...stylex.props(styles.main)}>
        {shouldRedirect ? null : <Outlet />}
      </main>
    </div>
  );
}
