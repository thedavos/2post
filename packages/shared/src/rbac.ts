/**
 * RBAC port of apps/members/models.py — permission keys, builtin role
 * mappings and hierarchy rules must stay identical to the legacy strings.
 */

export const PERMISSION_KEYS = [
  "create_posts",
  "edit_others_posts",
  "approve_posts",
  "publish_directly",
  "manage_social_accounts",
  "view_analytics",
  "use_inbox",
  "reply_from_inbox",
  "manage_workspace_settings",
  "upload_media",
  "edit_media",
  "delete_media",
  "manage_media",
] as const;

export type WorkspacePermission = (typeof PERMISSION_KEYS)[number];

export type WorkspaceRole = "owner" | "manager" | "editor" | "contributor" | "client" | "viewer";
export type OrgRole = "owner" | "admin" | "member";

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  "owner",
  "manager",
  "editor",
  "contributor",
  "client",
  "viewer",
];

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];

const allPermissions = (): Record<WorkspacePermission, boolean> =>
  Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) as Record<
    WorkspacePermission,
    boolean
  >;

const only = (...keys: WorkspacePermission[]): Record<WorkspacePermission, boolean> =>
  Object.fromEntries(PERMISSION_KEYS.map((k) => [k, keys.includes(k)])) as Record<
    WorkspacePermission,
    boolean
  >;

/** Parity with legacy BUILTIN_ROLE_PERMISSIONS. */
export const BUILTIN_ROLE_PERMISSIONS: Record<WorkspaceRole, Record<WorkspacePermission, boolean>> =
  {
    owner: allPermissions(),
    manager: only(
      "create_posts",
      "edit_others_posts",
      "approve_posts",
      "publish_directly",
      "manage_social_accounts",
      "view_analytics",
      "use_inbox",
      "reply_from_inbox",
      "upload_media",
      "edit_media",
      "delete_media",
      "manage_media",
    ),
    editor: only(
      "create_posts",
      "edit_others_posts",
      "view_analytics",
      "use_inbox",
      "reply_from_inbox",
      "upload_media",
      "edit_media",
    ),
    contributor: only("create_posts", "upload_media", "edit_media"),
    client: only("approve_posts", "view_analytics"),
    viewer: only("view_analytics"),
  };

export function workspacePermissions(role: WorkspaceRole): Set<WorkspacePermission> {
  return new Set(
    (Object.entries(BUILTIN_ROLE_PERMISSIONS[role]) as Array<[WorkspacePermission, boolean]>)
      .filter(([, granted]) => granted)
      .map(([key]) => key),
  );
}

export const ORG_PERMISSION_KEYS = [
  "manage_intelligence_billing",
  "use_intelligence",
  "manage_api_keys",
] as const;

export type OrgPermission = (typeof ORG_PERMISSION_KEYS)[number];

/** Parity with legacy BUILTIN_ORG_PERMISSIONS. */
export const BUILTIN_ORG_PERMISSIONS: Record<OrgRole, ReadonlySet<OrgPermission>> = {
  owner: new Set(["manage_intelligence_billing", "use_intelligence", "manage_api_keys"]),
  admin: new Set(["manage_intelligence_billing", "use_intelligence", "manage_api_keys"]),
  member: new Set(["use_intelligence"]),
};

export function hasOrgPermission(orgRole: OrgRole | null | undefined, key: OrgPermission): boolean {
  if (!orgRole) return false;
  return BUILTIN_ORG_PERMISSIONS[orgRole].has(key);
}

// ---------------------------------------------------------------------------
// Role hierarchy (V1 from the May-2026 security audit, ported from
// test_role_hierarchy.py): an org admin must not grant roles above their own,
// nor act on org owners.
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };
const WS_ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  client: 1,
  contributor: 2,
  editor: 3,
  manager: 4,
  owner: 5,
};

/**
 * Whether `actor` may assign `target` org/workspace roles in an organization.
 * Rules:
 * - owners can do anything
 * - admins cannot grant/act above their rank: they cannot touch owners or
 *   grant owner anywhere
 */
export function canGrantOrgRole(actor: OrgRole, target: OrgRole): boolean {
  return ROLE_RANK[actor] >= ROLE_RANK[target];
}

export function canGrantWorkspaceRole(actor: OrgRole, target: WorkspaceRole): boolean {
  // Granting workspace owner requires being org owner (parity with the
  // 422 in test_admin_cannot_invite_as_owner_of_workspace_they_only_view).
  if (target === "owner") return actor === "owner";
  return actor === "owner" || actor === "admin";
}

/** An admin cannot demote/remove an owner; owners can act on anyone. */
export function canActOnMember(actor: OrgRole, targetMemberRole: OrgRole): boolean {
  return ROLE_RANK[actor] >= ROLE_RANK[targetMemberRole];
}

export function workspaceRoleRank(role: WorkspaceRole): number {
  return WS_ROLE_RANK[role];
}
