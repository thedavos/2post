import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import type { OrgPermission, OrgRole } from "@brightbean/shared";
import { hasOrgPermission } from "@brightbean/shared";

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async requireOrgRole(userId: string, organizationId: string): Promise<OrgRole> {
    const membership = await this.prisma.orgMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { orgRole: true, organization: { select: { deletionScheduledAt: true } } },
    });

    if (!membership || membership.organization.deletionScheduledAt) {
      throw new NotFoundException("Organization not found");
    }

    return membership.orgRole as OrgRole;
  }

  async requireOrgPermission(
    userId: string,
    organizationId: string,
    permission: OrgPermission,
  ): Promise<OrgRole> {
    const role = await this.requireOrgRole(userId, organizationId);
    if (!hasOrgPermission(role, permission)) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return role;
  }

  /** owner/admin can manage the organization; members cannot. */
  async requireOrgAdmin(userId: string, organizationId: string): Promise<OrgRole> {
    const role = await this.requireOrgRole(userId, organizationId);
    if (role === "member") {
      throw new ForbiddenException("Insufficient permissions");
    }
    return role;
  }

  /// Resolves the workspace's org and checks membership in one step.
  async requireWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<{ organizationId: string; orgRole: OrgRole }> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, organizationId: true },
    });
    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    const orgRole = await this.requireOrgRole(userId, workspace.organizationId);
    return { organizationId: workspace.organizationId, orgRole };
  }
}
