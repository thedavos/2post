import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { JWT_COOKIE, ACCESS_TOKEN_TTL_SECONDS } from "../auth/auth.constants";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditAction } from "../../common/audit/audit.decorator";
import { organizationCreateSchema } from "@brightbean/shared";

const renameSchema = z.object({ name: z.string().min(1).max(120) });

/// Parity with legacy org-deletion grace period.
const DELETION_GRACE_DAYS = 14;

@UseGuards(JwtAuthGuard)
@Controller("api/app/organizations")
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly jwt: JwtService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedRequest["user"]) {
    const memberships = await this.prisma.orgMembership.findMany({
      where: { userId: user.sub, organization: { deletionScheduledAt: null } },
      select: {
        orgRole: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    return {
      results: memberships.map((m) => ({
        ...m.organization,
        orgRole: m.orgRole,
      })),
    };
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: AuthenticatedRequest["user"], @Body() body: unknown) {
    const input = organizationCreateSchema.parse(body);

    const slug = `${input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"}-${Date.now().toString(36)}`;

    // Parity with the legacy accounts post_save signal: every new org gets a
    // default workspace and an owner membership for its creator.
    const organization = await this.prisma.organization.create({
      data: {
        name: input.name,
        slug,
        orgMemberships: { create: { userId: user.sub, orgRole: "OWNER" } },
        workspaces: { create: { name: "Default Workspace", slug: "default" } },
      },
      select: { id: true, name: true, slug: true },
    });

    return organization;
  }

  @Patch(":orgId")
  async rename(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
    @Body() body: unknown,
  ) {
    await this.membership.requireOrgAdmin(user.sub, orgId);
    const input = renameSchema.parse(body);

    return this.prisma.organization.update({
      where: { id: orgId },
      data: { name: input.name },
      select: { id: true, name: true, slug: true },
    });
  }

  @Post(":orgId/switch")
  @HttpCode(200)
  async switchOrg(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const role = await this.membership.requireOrgRole(user.sub, orgId);
    void role;

    const accessToken = this.jwt.sign(
      { sub: user.sub, email: user.email, activeOrgId: orgId },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
    reply.setCookie(JWT_COOKIE, accessToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ACCESS_TOKEN_TTL_SECONDS,
    });

    return { ok: true, activeOrgId: orgId };
  }

  @AuditAction("organization.delete")
  @Delete(":orgId")
  async scheduleDeletion(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
  ) {
    const role = await this.membership.requireOrgAdmin(user.sub, orgId);
    if (role !== "owner") throw new NotFoundException("Organization not found");

    const deletionScheduledAt = new Date(
      Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { deletionScheduledAt },
    });

    return { ok: true, deletionScheduledAt };
  }
}
