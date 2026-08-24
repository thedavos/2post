import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { randomBytes } from "node:crypto";

import { issueApiKey } from "./api-key.crypto";
import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  permissions: z
    .array(z.enum(["create_posts", "publish_directly", "upload_media", "view_analytics"]))
    .default([]),
});

@UseGuards(JwtAuthGuard)
@Controller("api/app/organizations/:orgId/api-keys")
export class ApiKeysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
  ) {
    await this.membership.requireOrgPermission(user.sub, orgId, "manage_api_keys");

    return {
      results: await this.prisma.apiKey.findMany({
        where: { workspace: { organizationId: orgId }, revokedAt: null },
        select: {
          id: true,
          name: true,
          workspaceId: true,
          lookupPrefix: true,
          permissions: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    };
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
    @Body() body: unknown,
  ) {
    await this.membership.requireOrgPermission(user.sub, orgId, "manage_api_keys");
    const input = createSchema.parse(body);

    // The raw key is returned exactly once — only hashes are stored.
    const issued = issueApiKey();
    const created = await this.prisma.apiKey.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        lookupPrefix: issued.lookupPrefix,
        tokenHash: issued.tokenHash,
        permissions: input.permissions as never,
        issuedById: user.sub,
      },
      select: { id: true, name: true, createdAt: true },
    });

    return { ...created, token: issued.raw };
  }

  @Delete(":keyId")
  async revoke(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("orgId") orgId: string,
    @Param("keyId") keyId: string,
  ) {
    await this.membership.requireOrgPermission(user.sub, orgId, "manage_api_keys");

    const key = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
      select: { workspace: { select: { organizationId: true } } },
    });
    if (!key || key.workspace.organizationId !== orgId) {
      throw new ForbiddenException("API key not found in this organization");
    }

    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    void randomBytes;
    return { ok: true };
  }
}
