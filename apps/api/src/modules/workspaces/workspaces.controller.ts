import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditAction } from "../../common/audit/audit.decorator";
import { workspaceCreateSchema } from "@brightbean/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  branding: z.record(z.string(), z.string()).optional(),
  defaults: z.record(z.string(), z.unknown()).optional(),
});

@UseGuards(JwtAuthGuard)
@Controller("api/app")
export class WorkspacesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  @Get("organizations/:orgId/workspaces")
  async list(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
  ) {
    await this.membership.requireOrgRole(user.sub, orgId);

    const results = await this.prisma.workspace.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, slug: true, branding: true },
      orderBy: { createdAt: "asc" },
    });

    return { results };
  }

  @Post("organizations/:orgId/workspaces")
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
    @Body() body: unknown,
  ) {
    await this.membership.requireOrgAdmin(user.sub, orgId);
    const input = workspaceCreateSchema.parse(body);

    const slug =
      `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ws"}-${Date.now().toString(36)}`;

    return this.prisma.workspace.create({
      data: { organizationId: orgId, name: input.name, slug },
      select: { id: true, name: true, slug: true },
    });
  }

  @Patch("workspaces/:workspaceId")
  async update(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");

    // Whitelabel branding + defaults require org admin (parity with legacy
    // manage_workspace_settings gating on workspace settings pages).
    await this.membership.requireOrgAdmin(user.sub, workspace.organizationId);
    const input = updateSchema.parse(body);

    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.branding !== undefined ? { branding: input.branding } : {}),
      ...(input.defaults !== undefined
        ? { defaults: input.defaults as never }
        : {}),
    };

    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
      select: { id: true, name: true, branding: true, defaults: true },
    });
  }

  @AuditAction("workspace.delete")
  @Delete("workspaces/:workspaceId")
  async remove(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");

    const role = await this.membership.requireOrgAdmin(user.sub, workspace.organizationId);
    if (role !== "owner") throw new ForbiddenException("Only owners can delete workspaces");

    await this.prisma.workspace.delete({ where: { id: workspaceId } });
    return { ok: true };
  }
}
