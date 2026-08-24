import { z } from "zod";

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

import {
  queueCreateSchema,
  queueEntryAddSchema,
  slotCreateSchema,
} from "@brightbean/shared";
import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { assignNextSlotDatetime } from "./queue-assignment";

@UseGuards(JwtAuthGuard)
@Controller("api/app")
export class CalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  // ------------------------------------------------------------------ slots

  @Get("social-accounts/:accountId/slots")
  async listSlots(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("accountId") accountId: string,
  ) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: { workspaceId: true },
    });
    if (!account) throw new NotFoundException("Social account not found");
    await this.membership.requireWorkspace(user.sub, account.workspaceId);

    return {
      results: await this.prisma.postingSlot.findMany({
        where: { socialAccountId: accountId },
        orderBy: [{ dayOfWeek: "asc" }, { time: "asc" }],
      }),
    };
  }

  @Post("social-accounts/:accountId/slots")
  @HttpCode(201)
  async createSlot(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("accountId") accountId: string,
    @Body() body: unknown,
  ) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: { workspaceId: true },
    });
    if (!account) throw new NotFoundException("Social account not found");
    await this.membership.requireWorkspace(user.sub, account.workspaceId);

    const input = slotCreateSchema.parse(body);
    return this.prisma.postingSlot.create({
      data: {
        socialAccountId: accountId,
        dayOfWeek: input.dayOfWeek,
        time: input.time,
      },
    });
  }

  @Delete("slots/:slotId")
  async deleteSlot(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("slotId") slotId: string,
  ) {
    const slot = await this.prisma.postingSlot.findUnique({
      where: { id: slotId },
      select: { socialAccount: { select: { workspaceId: true } } },
    });
    if (!slot) throw new NotFoundException("Slot not found");

    const { orgRole } = await this.membership.requireWorkspace(user.sub, slot.socialAccount.workspaceId);
    if (orgRole === "member") throw new ForbiddenException("Insufficient permissions");

    await this.prisma.postingSlot.delete({ where: { id: slotId } });
    return { ok: true };
  }

  // ----------------------------------------------------------------- queues

  @Get("workspaces/:workspaceId/queues")
  async listQueues(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);

    return {
      results: await this.prisma.queue.findMany({
        where: { workspaceId },
        include: { entries: { orderBy: { position: "asc" }, select: { id: true, postId: true, position: true, assignedSlotDatetime: true } } },
        orderBy: { createdAt: "asc" },
      }),
    };
  }

  @Post("workspaces/:workspaceId/queues")
  @HttpCode(201)
  async createQueue(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
  ) {
    const { orgRole } = await this.membership.requireWorkspace(user.sub, workspaceId);
    if (orgRole === "member") throw new ForbiddenException("Insufficient permissions");

    const input = queueCreateSchema.parse(body);
    return this.prisma.queue.create({
      data: {
        workspaceId,
        name: input.name,
        categoryId: input.categoryId ?? null,
        accountId: input.accountId ?? null,
      },
    });
  }

  @Post("queues/:queueId/entries")
  @HttpCode(201)
  async addEntry(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("queueId") queueId: string,
    @Body() body: unknown,
  ) {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      select: { id: true, workspaceId: true, accountId: true },
    });
    if (!queue) throw new NotFoundException("Queue not found");
    await this.membership.requireWorkspace(user.sub, queue.workspaceId);

    const input = queueEntryAddSchema.parse(body);

    const post = await this.prisma.post.findFirst({
      where: { id: input.postId, workspaceId: queue.workspaceId },
      select: { id: true },
    });
    if (!post) throw new NotFoundException("Post not found in this workspace");

    const count = await this.prisma.queueEntry.count({ where: { queueId } });
    const assignedSlotDatetime = await assignNextSlotDatetime(this.prisma, queue);

    return this.prisma.queueEntry.create({
      data: {
        queueId,
        postId: input.postId,
        position: count,
        assignedSlotDatetime,
      },
    });
  }

  @Delete("queues/:queueId/entries/:entryId")
  async removeEntry(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("queueId") queueId: string,
    @Param("entryId") entryId: string,
  ) {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      select: { workspaceId: true },
    });
    if (!queue) throw new NotFoundException("Queue not found");
    await this.membership.requireWorkspace(user.sub, queue.workspaceId);

    await this.prisma.queueEntry.delete({ where: { id: entryId } });
    return { ok: true };
  }

  @Patch("queues/:queueId/entries/:entryId/reschedule")
  @HttpCode(200)
  async rescheduleEntry(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("queueId") queueId: string,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
  ) {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      select: { id: true, workspaceId: true, accountId: true },
    });
    if (!queue) throw new NotFoundException("Queue not found");
    await this.membership.requireWorkspace(user.sub, queue.workspaceId);

    const input = z.object({ assignedAt: z.coerce.date() }).parse(body);

    const updated = await this.prisma.queueEntry.update({
      where: { id: entryId },
      data: { assignedSlotDatetime: input.assignedAt },
    });

    // Keep the platform variants in sync with the calendar move (drag-and-drop).
    await this.prisma.platformPost.updateMany({
      where: { postId: updated.postId, status: "SCHEDULED" },
      data: { scheduledAt: input.assignedAt },
    });
    await this.prisma.post.update({
      where: { id: updated.postId },
      data: { scheduledAt: input.assignedAt },
    });

    return updated;
  }
}

