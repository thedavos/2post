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
  Query,
  UseGuards,
} from "@nestjs/common";

import {
  canTransitionTo,
  derivePostStatus,
  isSchedulable,
  postCreateSchema,
  postScheduleSchema,
  platformPostTransitionSchema,
  postUpdateSchema,
  type PlatformPostStatus,
} from "@brightbean/shared";
import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";

@UseGuards(JwtAuthGuard)
@Controller("api/app/workspaces/:workspaceId/posts")
export class ComposerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Query("status") status?: string,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);

    const posts = await this.prisma.post.findMany({
      where: { workspaceId },
      include: { platformPosts: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return {
      results: posts
        .map((p) => this.withDerivedStatus(p))
        .filter((p) => !status || p.status === status),
    };
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);
    const input = postCreateSchema.parse(body);

    const post = await this.prisma.post.create({
      data: {
        workspaceId,
        authorId: user.sub,
        title: input.title,
        caption: input.caption,
        firstComment: input.firstComment,
        internalNotes: input.internalNotes,
        tags: input.tags,
        categoryId: input.categoryId ?? null,
        scheduledAt: input.scheduledAt ?? null,
        platformPosts: {
          create: input.targets.map((t) => ({
            socialAccountId: t.socialAccountId,
            platformSpecificCaption: t.caption ?? null,
            platformSpecificTitle: t.title ?? null,
            platformSpecificFirstComment: t.firstComment ?? null,
          })),
        },
      },
      include: { platformPosts: true },
    });

    return this.withDerivedStatus(post);
  }

  @Get(":postId")
  async detail(
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
            socialAccount: {
              select: { id: true, platform: true, accountName: true, accountHandle: true },
            },
          },
        },
        category: { select: { id: true, name: true, color: true } },
      },
    });
    if (!post) throw new NotFoundException("Post not found");

    return this.withDerivedStatus(post);
  }

  @Patch(":postId")
  async update(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Param("postId") postId: string,
    @Body() body: unknown,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);
    const input = postUpdateSchema.parse(body);

    const existing = await this.prisma.post.findFirst({
      where: { id: postId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Post not found");

    const post = await this.prisma.post.update({
      where: { id: postId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
        ...(input.firstComment !== undefined ? { firstComment: input.firstComment } : {}),
        ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
        ...(input.tags !== undefined ? { tags: input.tags as never } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId ?? null } : {}),
      },
      include: { platformPosts: { select: { status: true } } },
    });

    return this.withDerivedStatus(post);
  }

  @Delete(":postId")
  async remove(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Param("postId") postId: string,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);

    const existing = await this.prisma.post.findFirst({
      where: { id: postId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Post not found");

    // Explicit deletion intentionally bypasses PROTECTED_STATUSES (legacy parity).
    await this.prisma.post.delete({ where: { id: postId } });
    return { ok: true };
  }

  /// Schedules every schedulable platform variant; variants in editorial
  /// states (pending_review etc.) are left untouched (legacy parity).
  @Post(":postId/schedule")
  @HttpCode(200)
  async schedule(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Param("postId") postId: string,
    @Body() body: unknown,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);
    const input = postScheduleSchema.parse(body);

    const post = await this.prisma.post.findFirst({
      where: { id: postId, workspaceId },
      include: { platformPosts: true },
    });
    if (!post) throw new NotFoundException("Post not found");

    const now = new Date();
    let scheduled = 0;
    for (const pp of post.platformPosts) {
      if (!isSchedulable(pp.status.toLowerCase() as never)) continue;
      if (!canTransitionTo(pp.status.toLowerCase() as PlatformPostStatus, "scheduled")) continue;
      await this.prisma.platformPost.update({
        where: { id: pp.id },
        data: { status: "SCHEDULED", scheduledAt: input.scheduledAt, nextRetryAt: null },
      });
      scheduled += 1;
    }
    void now;

    await this.prisma.post.update({
      where: { id: postId },
      data: { scheduledAt: input.scheduledAt },
    });

    return { ok: true, scheduled };
  }

  @Post("platform-posts/:platformPostId/status")
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Param("platformPostId") platformPostId: string,
    @Body() body: unknown,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);
    const input = platformPostTransitionSchema.parse(body);

    const pp = await this.prisma.platformPost.findFirst({
      where: { id: platformPostId, post: { workspaceId } },
    });
    if (!pp) throw new NotFoundException("Platform post not found");

    const from = pp.status.toLowerCase() as PlatformPostStatus;
    if (!canTransitionTo(from, input.status)) {
      throw new Error(`Invalid transition ${from} → ${input.status}`);
    }

    const updated = await this.prisma.platformPost.update({
      where: { id: platformPostId },
      data: {
        status: input.status.toUpperCase() as Uppercase<PlatformPostStatus>,
        ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt ?? null } : {}),
      },
    });

    return updated;
  }

  private withDerivedStatus<
    T extends { platformPosts: Array<{ status: string }> },
  >(post: T): T & { status: string } {
    return {
      ...post,
      status: derivePostStatus(post.platformPosts.map((pp) => pp.status.toLowerCase())),
    };
  }
}
