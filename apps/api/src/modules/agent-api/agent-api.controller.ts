import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { PrismaService } from "../../prisma/prisma.service";
import { ApiKeyGuard, type ApiKeyRequest } from "../api-keys/api-key.guard";

/**
 * External agent REST API — contract parity with legacy /api/v1 (django-ninja):
 * same paths, auth (bb_studio_ bearer) and permission model. Payload shapes
 * must not change without explicit human approval.
 */

function permissions(request: FastifyRequest): string[] {
  const stored = ((request as ApiKeyRequest).apiKey.permissions as unknown as string[]) ?? [];
  return Array.isArray(stored) ? stored : [];
}

function requirePermission(request: FastifyRequest, permission: string): void {
  if (!permissions(request).includes(permission)) {
    throw new ForbiddenException(`${permission} required`);
  }
}

@UseGuards(ApiKeyGuard)
@Controller("api/v1")
export class AgentApiController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("me")
  async me(@Req() request: FastifyRequest) {
    const key = (request as ApiKeyRequest).apiKey;
    return {
      key_id: key.id,
      name: key.name,
      workspace: key.workspaceId,
      permissions: permissions(request),
    };
  }

  @Get("accounts")
  async accounts(@Req() request: FastifyRequest) {
    const key = (request as ApiKeyRequest).apiKey;
    const results = await this.prisma.socialAccount.findMany({
      where: { workspaceId: key.workspaceId, connectionStatus: "CONNECTED" },
      select: {
        id: true,
        platform: true,
        accountName: true,
        accountHandle: true,
        avatarUrl: true,
        followerCount: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return { results };
  }

  @Post("posts")
  createPost(@Req() request: FastifyRequest): never {
    requirePermission(request, "create_posts");
    // Draft/schedule creation lands with the composer contract tests phase.
    throw new NotFoundException("Not implemented yet");
  }

  @Get("posts/:postId")
  async getPost(@Req() request: FastifyRequest, @Param("postId") postId: string) {
    const key = (request as ApiKeyRequest).apiKey;
    const post = await this.prisma.post.findFirst({
      where: { id: postId, workspaceId: key.workspaceId },
      select: {
        id: true,
        caption: true,
        scheduledAt: true,
        publishedAt: true,
        platformPosts: {
          select: {
            status: true,
            platformPostId: true,
            socialAccount: { select: { platform: true } },
          },
        },
      },
    });
    if (!post) throw new NotFoundException("Post not found");
    return post;
  }

  @Get("analytics/accounts/:accountId")
  async accountAnalytics(
    @Req() request: FastifyRequest,
    @Param("accountId") accountId: string,
    @Query("days") days?: string,
  ) {
    requirePermission(request, "view_analytics");

    const window = Math.min(Math.max(Number(days ?? 7) || 7, 1), 90);
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

    const snapshots = await this.prisma.accountMetricSnapshot.findMany({
      where: { socialAccountId: accountId, capturedFor: { gte: since } },
      orderBy: { capturedFor: "asc" },
      take: 200,
    });
    if (snapshots.length === 0) {
      throw new NotFoundException("No analytics data for this account");
    }

    const latest = snapshots[snapshots.length - 1]!;
    return {
      account_id: accountId,
      window_days: window,
      followers: latest.followers,
      reach: latest.reach,
      impressions: latest.impressions,
      series: snapshots.map((s) => ({
        date: s.capturedFor.toISOString().slice(0, 10),
        followers: s.followers,
        reach: s.reach,
        impressions: s.impressions,
      })),
    };
  }
}
