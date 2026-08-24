import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import {
  canActOnMember,
  canGrantOrgRole,
  canGrantWorkspaceRole,
  inviteInputSchema,
  type InviteInput,
  workspacePermissions,
  workspaceRoleRank,
  type WorkspaceRole,
} from "@brightbean/shared";
import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";

const INVITE_TTL_DAYS = 14;

export class InviteDeniedError extends ForbiddenException {
  constructor(message = "You cannot grant this role") {
    super(message);
  }
}

/**
 * Hierarchy enforcement ported from apps/members/views.py +
 * test_role_hierarchy.py (V1 security audit rules).
 */
export function assertCanInvite(
  actorOrgRole: "owner" | "admin" | "member",
  input: InviteInput,
  actorWorkspaceRoles: Map<string, WorkspaceRole>,
): void {
  // Only owners/admins may invite at all (controller enforces this via
  // requireOrgAdmin; re-checked here to keep the rule self-contained).
  if (!canGrantOrgRole(actorOrgRole, input.orgRole) || actorOrgRole === "member") {
    throw new InviteDeniedError(
      actorOrgRole === "member"
        ? "Only owners and admins can invite members"
        : "You cannot invite with an org role above your own",
    );
  }

  for (const [workspaceId, targetWsRole] of Object.entries(input.workspaceRoles)) {
    const actorWsRole = actorWorkspaceRoles.get(workspaceId);

    // Org owners may assign any workspace role anywhere in their org.
    if (actorOrgRole === "owner") continue;

    if (!actorWsRole) {
      throw new InviteDeniedError(
        `You are not a member of one of the selected workspaces (${workspaceId})`,
      );
    }
    if (
      !canGrantWorkspaceRole(actorOrgRole, targetWsRole) ||
      workspaceRoleRank(targetWsRole) > workspaceRoleRank(actorWsRole)
    ) {
      throw new InviteDeniedError(
        `You cannot grant a workspace role above your own (${workspaceId})`,
      );
    }
  }
}

@UseGuards(JwtAuthGuard)
@Controller("api/app/organizations/:orgId/members")
export class MembersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedRequest["user"], @Param("orgId") orgId: string) {
    await this.membership.requireOrgRole(user.sub, orgId);

    const memberships = await this.prisma.orgMembership.findMany({
      where: { organizationId: orgId },
      select: {
        orgRole: true,
        createdAt: true,
        user: { select: { id: true, email: true, displayName: true, isActive: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return { results: memberships };
  }

  @Post("invitations")
  @HttpCode(201)
  async invite(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
    @Body() body: unknown,
  ) {
    const actorOrgRole = await this.membership.requireOrgAdmin(user.sub, orgId);
    const input = inviteInputSchema.parse(body);

    const actorWsMemberships = await this.prisma.workspaceMembership.findMany({
      where: { userId: user.sub, workspace: { organizationId: orgId } },
      select: { workspaceId: true, workspaceRole: true },
    });
    const actorWsRoles = new Map(
      actorWsMemberships.map((m) => [m.workspaceId, m.workspaceRole.toLowerCase() as WorkspaceRole]),
    );

    assertCanInvite(actorOrgRole.toLowerCase() as "owner" | "admin" | "member", input, actorWsRoles);

    const rawToken = randomBytes(32).toString("base64url");

    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: orgId,
        email: input.email,
        orgRole: input.orgRole.toUpperCase() as "OWNER" | "ADMIN" | "MEMBER",
        workspaceRoles: input.workspaceRoles,
        tokenHash: createHash("sha256").update(rawToken).digest("hex"),
        invitedById: user.sub,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
      select: { id: true, email: true, expiresAt: true },
    });

    // Email delivery lands with NotificationsModule (later phase); the raw
    // token is returned once here so dev flows can complete invites.
    return { ...invitation, token: rawToken };
  }

  @Get("invitations")
  async invitations(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
  ) {
    await this.membership.requireOrgRole(user.sub, orgId);

    const results = await this.prisma.invitation.findMany({
      where: { organizationId: orgId, acceptedAt: null },
      select: { id: true, email: true, orgRole: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    return { results };
  }

  @Post(":userId/workspace-roles")
  @HttpCode(200)
  async setWorkspaceRole(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
    @Param("userId") targetUserId: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({ workspaceId: z.string().uuid(), role: z.enum(["owner", "manager", "editor", "contributor", "client", "viewer"]) })
      .parse(body);

    const actorOrgRole = (await this.membership.requireOrgAdmin(user.sub, orgId)).toLowerCase() as
      | "owner"
      | "admin"
      | "member";

    const targetMembership = await this.prisma.orgMembership.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
      select: { orgRole: true },
    });
    if (!targetMembership) throw new ForbiddenException("Not a member of this organization");

    // An admin cannot demote an owner (parity: test_admin_cannot_demote_owner).
    if (!canActOnMember(actorOrgRole, targetMembership.orgRole.toLowerCase() as "owner" | "admin" | "member")) {
      throw new InviteDeniedError("You cannot modify a member above your own role");
    }

    if (!canGrantWorkspaceRole(actorOrgRole, input.role)) {
      throw new InviteDeniedError("You cannot grant this workspace role");
    }

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: input.workspaceId, organizationId: orgId },
      select: { id: true },
    });
    if (!workspace) throw new ForbiddenException("Workspace not in this organization");

    await this.prisma.workspaceMembership.upsert({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId: input.workspaceId } },
      create: {
        userId: targetUserId,
        workspaceId: input.workspaceId,
        workspaceRole: input.role.toUpperCase() as Uppercase<WorkspaceRole>,
      },
      update: {
        workspaceRole: input.role.toUpperCase() as Uppercase<WorkspaceRole>,
      },
    });

    return { ok: true, permissions: [...workspacePermissions(input.role)] };
  }
}
