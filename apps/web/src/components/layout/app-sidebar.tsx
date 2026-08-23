import { Link, useLocation } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";

import { colors, fontSizes, spacing } from "../../styles/tokens.stylex";

const NAV_ITEMS = [
  { to: "/workspaces", label: "Workspaces" },
] as const;

const WORKSPACE_NAV = [
  { suffix: "calendar", label: "Calendar" },
  { suffix: "composer", label: "Compose" },
  { suffix: "approvals", label: "Approvals" },
  { suffix: "inbox", label: "Inbox" },
  { suffix: "analytics", label: "Analytics" },
  { suffix: "media", label: "Media Library" },
  { suffix: "social-accounts", label: "Channels" },
  { suffix: "members", label: "Team" },
  { suffix: "settings/clients", label: "Client Portal" },
  { suffix: "settings", label: "Settings" },
] as const;

const styles = stylex.create({
  sidebar: {
    width: 240,
    flexShrink: 0,
    backgroundColor: colors.sidebar,
    color: colors.sidebarForeground,
    display: "flex",
    flexDirection: "column",
    padding: spacing[4],
    gap: spacing[6],
  },
  brand: {
    fontSize: fontSizes.lg,
    fontWeight: 700,
    color: "#ffffff",
    textDecoration: "none",
  },
  sectionLabel: {
    fontSize: fontSizes.xs,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: colors.sidebarForeground,
    marginBottom: spacing[2],
  },
  nav: { display: "flex", flexDirection: "column", gap: spacing[1] },
  item: {
    display: "block",
    paddingBlock: spacing[2],
    paddingInline: spacing[3],
    borderRadius: 8,
    fontSize: fontSizes.sm,
    textDecoration: "none",
    ":hover": { backgroundColor: "rgba(255,255,255,0.08)" },
  },
  itemActive: {
    backgroundColor: colors.sidebarActive,
    color: "#ffffff",
    ":hover": { backgroundColor: colors.sidebarActive },
  },
  orgFooter: {
    marginTop: "auto",
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: "rgba(255,255,255,0.12)",
    fontSize: fontSizes.xs,
  },
});

export function AppSidebar({ orgName }: { orgName?: string }) {
  const location = useLocation();
  const workspaceMatch = location.pathname.match(/\/workspace\/([^/]+)/);
  const activeWorkspaceId = workspaceMatch?.[1];

  return (
    <aside {...stylex.props(styles.sidebar)}>
      <Link to="/" {...stylex.props(styles.brand)}>
        2post
      </Link>

      <nav {...stylex.props(styles.nav)}>
        <div {...stylex.props(styles.sectionLabel)}>General</div>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            {...stylex.props(
              styles.item,
              location.pathname === item.to && styles.itemActive,
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {activeWorkspaceId && (
        <nav {...stylex.props(styles.nav)}>
          <div {...stylex.props(styles.sectionLabel)}>
            {orgName ?? "Workspace"}
          </div>
          {WORKSPACE_NAV.map((item) => {
            const to = `/workspace/${activeWorkspaceId}/${item.suffix}`;
            return (
              <Link
                key={item.suffix}
                to={to}
                {...stylex.props(
                  styles.item,
                  location.pathname.startsWith(to) && styles.itemActive,
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}

      <div {...stylex.props(styles.orgFooter)}>
        {orgName ? `Signed in to ${orgName}` : "2post"}
      </div>
    </aside>
  );
}
