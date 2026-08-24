import { describe, expect, it } from "vitest";

import {
  BUILTIN_ORG_PERMISSIONS,
  BUILTIN_ROLE_PERMISSIONS,
  PERMISSION_KEYS,
  canActOnMember,
  canGrantWorkspaceRole,
  hasOrgPermission,
  workspacePermissions,
  workspaceRoleRank,
} from "@brightbean/shared";
import { InviteDeniedError, assertCanInvite } from "./members.controller";

/**
 * Port of apps/members/tests/test_role_hierarchy.py (V1 security audit).
 */
describe("role hierarchy (port of test_role_hierarchy.py)", () => {
  it("admin cannot invite as owner of a workspace they only view", () => {
    const actorWsRoles = new Map([["ws-a", "viewer" as const]]);
    expect(() =>
      assertCanInvite(
        "admin",
        {
          email: "victim@example.com",
          orgRole: "member",
          workspaceRoles: { "ws-a": "owner" },
        },
        actorWsRoles,
      ),
    ).toThrow(InviteDeniedError);
  });

  it("admin cannot invite into a workspace they don't belong to", () => {
    expect(() =>
      assertCanInvite(
        "admin",
        { email: "victim@example.com", orgRole: "member", workspaceRoles: { "ws-b": "editor" } },
        new Map(), // admin not a member of ws-b
      ),
    ).toThrow(InviteDeniedError);
  });

  it("admin cannot grant the org owner role", () => {
    expect(() =>
      assertCanInvite(
        "admin",
        { email: "victim@example.com", orgRole: "owner", workspaceRoles: {} },
        new Map(),
      ),
    ).toThrow(InviteDeniedError);
  });

  it("member org role cannot invite at all (requires admin)", () => {
    expect(() =>
      assertCanInvite(
        "member",
        { email: "victim@example.com", orgRole: "member", workspaceRoles: {} },
        new Map(),
      ),
    ).toThrow(InviteDeniedError);
  });

  it("owner can grant any role anywhere", () => {
    expect(() =>
      assertCanInvite(
        "owner",
        {
          email: "victim@example.com",
          orgRole: "owner",
          workspaceRoles: { "ws-a": "owner" },
        },
        new Map(),
      ),
    ).not.toThrow();
  });

  it("admin can invite with a role up to their own workspace rank", () => {
    expect(() =>
      assertCanInvite(
        "admin",
        { email: "victim@example.com", orgRole: "member", workspaceRoles: { "ws-a": "manager" } },
        new Map([["ws-a", "manager" as const]]),
      ),
    ).not.toThrow();
  });

  it("an admin cannot act on an owner; owners can act on anyone", () => {
    expect(canActOnMember("admin", "owner")).toBe(false);
    expect(canActOnMember("admin", "admin")).toBe(true);
    expect(canActOnMember("owner", "owner")).toBe(true);
  });
});

/**
 * Parity with legacy BUILTIN_ROLE_PERMISSIONS / BUILTIN_ORG_PERMISSIONS.
 * These strings appear in API responses and docs — do not change them.
 */
describe("permission matrices", () => {
  it("workspace roles match legacy maps exactly", () => {
    const perms = (role: keyof typeof BUILTIN_ROLE_PERMISSIONS) =>
      Object.entries(BUILTIN_ROLE_PERMISSIONS[role])
        .filter(([, v]) => v)
        .map(([k]) => k)
        .sort();

    expect(perms("owner")).toEqual([...PERMISSION_KEYS].sort());
    expect(perms("manager")).toEqual(
      [
        "approve_posts",
        "create_posts",
        "delete_media",
        "edit_media",
        "edit_others_posts",
        "manage_media",
        "manage_social_accounts",
        "publish_directly",
        "reply_from_inbox",
        "upload_media",
        "use_inbox",
        "view_analytics",
      ].sort(),
    );
    expect(perms("client")).toEqual(["approve_posts", "view_analytics"]);
    expect(perms("viewer")).toEqual(["view_analytics"]);
  });

  it("org permissions match legacy map exactly", () => {
    expect([...BUILTIN_ORG_PERMISSIONS.member]).toEqual(["use_intelligence"]);
    expect(hasOrgPermission("admin", "manage_api_keys")).toBe(true);
    expect(hasOrgPermission("member", "manage_api_keys")).toBe(false);
    expect(hasOrgPermission(null, "use_intelligence")).toBe(false);
  });

  it("workspace permission helper derives sets from the matrix", () => {
    expect(workspacePermissions("viewer").has("view_analytics")).toBe(true);
    expect(workspacePermissions("viewer").has("create_posts")).toBe(false);
    expect(workspaceRoleRank("owner")).toBeGreaterThan(workspaceRoleRank("manager"));
    expect(canGrantWorkspaceRole("owner", "owner")).toBe(true);
    expect(canGrantWorkspaceRole("admin", "owner")).toBe(false);
  });
});
