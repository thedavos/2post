import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { ClientPortalService } from "./client-portal.service";
import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";

@UseGuards(JwtAuthGuard)
@Controller("api/app/workspaces/:workspaceId/portal")
export class ClientPortalAdminController {
  constructor(
    private readonly portal: ClientPortalService,
    private readonly membership: MembershipService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("links")
  @HttpCode(201)
  async issue(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
  ) {
    const input = z.object({ email: z.string().email().max(254) }).parse(body);
    // Any workspace editor+ can issue links (legacy parity).
    await this.membership.requireWorkspace(user.sub, workspaceId);

    const link = await this.portal.issueLink(user.sub, workspaceId, input.email);
    return link;
  }

  @Get("posts")
  async pendingPosts(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Query("status") status = "PENDING_REVIEW",
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);
    const results = await this.prisma.platformPost.findMany({
      where: {
        post: { workspaceId },
        status: (status.toUpperCase() as "PENDING_REVIEW" | "PENDING_CLIENT") || "PENDING_CLIENT",
      },
      include: { post: { select: { id: true, caption: true, title: true } } },
      take: 100,
    });
    return { results };
  }
}

/// Public portal endpoints — auth via the magic-link token in the query.
@Controller("api/app/portal")
export class ClientPortalController {
  constructor(
    private readonly portal: ClientPortalService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("feed")
  async feed(@Query("token") token?: string) {
    if (!token) throw new NotFoundException("Invalid or expired link");
    const access = await this.portal.redeem(token);

    const results = await this.prisma.platformPost.findMany({
      where: {
        post: { workspaceId: access.workspaceId },
        status: { in: ["PENDING_CLIENT", "APPROVED", "REJECTED", "SCHEDULED", "PUBLISHED"] },
      },
      include: { post: { select: { id: true, caption: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return { workspace_id: access.workspaceId, email: access.email, results };
  }

  @Post("decision")
  @HttpCode(200)
  async decide(@Body() body: unknown) {
    const input = z
      .object({
        token: z.string().min(10),
        platformPostId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
      })
      .parse(body);

    const access = await this.portal.redeem(input.token);

    const platformPost = await this.prisma.platformPost.findFirst({
      where: { id: input.platformPostId, post: { workspaceId: access.workspaceId } },
      select: { id: true, status: true },
    });
    if (!platformPost) throw new NotFoundException("Post not found in this workspace");

    const nextStatus =
      input.decision === "approve"
        ? platformPost.status === "PENDING_CLIENT"
          ? "APPROVED"
          : "PENDING_CLIENT"
        : "REJECTED";

    await this.prisma.platformPost.update({
      where: { id: platformPost.id },
      data: { status: nextStatus },
    });

    return { ok: true, status: nextStatus.toLowerCase() };
  }
}
