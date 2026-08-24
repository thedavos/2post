import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";

import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";

@UseGuards(JwtAuthGuard)
@Controller("api/app/workspaces/:workspaceId/analytics")
export class AnalyticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  /// Channel-level KPIs over a rolling window (7/30/90 parity).
  @Get("accounts/:accountId")
  async accountAnalytics(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Param("accountId") accountId: string,
    @Query("days") days?: string,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);
    const window = Math.min(Math.max(Number(days ?? 7) || 7, 1), 90);
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

    const snapshots = await this.prisma.accountMetricSnapshot.findMany({
      where: { socialAccountId: accountId, capturedFor: { gte: since } },
      orderBy: { capturedFor: "asc" },
    });
    if (snapshots.length === 0) throw new NotFoundException("No analytics data for this account");

    const sum = (key: "reach" | "impressions" | "views" | "engagements") =>
      snapshots.reduce((acc, s) => acc + (s[key] ?? 0), 0);

    return {
      account_id: accountId,
      window_days: window,
      kpis: {
        followers_latest: snapshots[snapshots.length - 1]!.followers,
        reach_total: sum("reach"),
        impressions_total: sum("impressions"),
        views_total: sum("views"),
        engagements_total: sum("engagements"),
      },
      series: snapshots.map((s) => ({
        date: s.capturedFor.toISOString().slice(0, 10),
        followers: s.followers,
        follower_delta: s.followerDelta,
        reach: s.reach,
        impressions: s.impressions,
        views: s.views,
        engagements: s.engagements,
      })),
    };
  }

  /// Per-post metrics incl. per-platform breakdown (legacy post drawer).
  @Get("posts/:postId")
  async postAnalytics(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Param("postId") postId: string,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);

    const post = await this.prisma.post.findFirst({
      where: { id: postId, workspaceId },
      include: {
        platformPosts: {
          include: {
            socialAccount: { select: { platform: true, accountName: true } },
            metricSnapshots: { orderBy: { capturedFor: "desc" }, take: 1 },
          },
        },
      },
    });
    if (!post) throw new NotFoundException("Post not found");

    return {
      post_id: post.id,
      platforms: post.platformPosts.map((pp) => ({
        platform: pp.socialAccount.platform,
        status: pp.status.toLowerCase(),
        platform_post_id: pp.platformPostId || null,
        latest_metrics: pp.metricSnapshots[0]
          ? {
              captured_for: pp.metricSnapshots[0].capturedFor.toISOString(),
              impressions: pp.metricSnapshots[0].impressions,
              reach: pp.metricSnapshots[0].reach,
              likes: pp.metricSnapshots[0].likes,
              comments: pp.metricSnapshots[0].comments,
              shares: pp.metricSnapshots[0].shares,
              views: pp.metricSnapshots[0].views,
              watch_time_ms: pp.metricSnapshots[0].watchTimeMs,
            }
          : null,
      })),
    };
  }

  /// Sortable all-posts table (views/engagement totals per post).
  @Get("posts")
  async postsTable(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Query("sort") sort: "views" | "engagements" | "date" = "date",
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);

    const posts = await this.prisma.post.findMany({
      where: { workspaceId },
      include: { platformPosts: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const platformPostIds = posts.flatMap((p) => p.platformPosts.map((pp) => pp.id));
    const snapshots = await this.prisma.postMetricSnapshot.findMany({
      where: { platformPostId: { in: platformPostIds } },
      orderBy: { capturedFor: "asc" },
    });

    // Latest snapshot per platform post.
    const latestByPlatformPost = new Map<string, (typeof snapshots)[number]>();
    for (const snap of snapshots) latestByPlatformPost.set(snap.platformPostId, snap);

    const rows = posts.map((post) => {
      let views = 0;
      let engagements = 0;
      for (const pp of post.platformPosts) {
        const snap = latestByPlatformPost.get(pp.id);
        if (!snap) continue;
        views += snap.views ?? 0;
        engagements +=
          (snap.likes ?? 0) + (snap.comments ?? 0) + (snap.shares ?? 0);
      }
      return {
        post_id: post.id,
        title: post.title,
        created_at: post.createdAt.toISOString(),
        published_at: post.publishedAt?.toISOString() ?? null,
        scheduled_at: post.scheduledAt?.toISOString() ?? null,
        views,
        engagements,
      };
    });

    rows.sort((a, b) => {
      if (sort === "views") return b.views - a.views;
      if (sort === "engagements") return b.engagements - a.engagements;
      return b.created_at.localeCompare(a.created_at);
    });

    return { results: rows };
  }
}
