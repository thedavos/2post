import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { PrismaService } from "../../prisma/prisma.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";

const prefsSchema = z.object({
  eventType: z.string().min(1).max(100),
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
  webhook: z.boolean().optional(),
});

@UseGuards(JwtAuthGuard)
@Controller("api/app")
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("notifications")
  async list(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Query("unread") unread?: string,
  ) {
    const results = await this.prisma.notification.findMany({
      where: {
        userId: user.sub,
        ...(unread === "true" ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        eventType: true,
        title: true,
        body: true,
        payload: true,
        readAt: true,
        createdAt: true,
      },
    });

    const unreadCount = await this.prisma.notification.count({
      where: { userId: user.sub, readAt: null },
    });

    return { results, unread_count: unreadCount };
  }

  @Patch("notifications/:notificationId/read")
  async markRead(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("notificationId") notificationId: string,
  ) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId: user.sub, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @Patch("notifications/preferences")
  async setPreference(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Body() body: unknown,
  ) {
    const input = prefsSchema.parse(body);
    const preference = await this.prisma.notificationPreference.upsert({
      where: { userId_eventType: { userId: user.sub, eventType: input.eventType } },
      create: {
        userId: user.sub,
        eventType: input.eventType,
        ...(input.inApp !== undefined ? { inApp: input.inApp } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.webhook !== undefined ? { webhook: input.webhook } : {}),
      },
      update: {
        ...(input.inApp !== undefined ? { inApp: input.inApp } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.webhook !== undefined ? { webhook: input.webhook } : {}),
      },
    });
    return preference;
  }

  @Get("notifications/preferences")
  async getPreferences(@CurrentUser() user: AuthenticatedRequest["user"]) {
    return {
      results: await this.prisma.notificationPreference.findMany({
        where: { userId: user.sub },
      }),
    };
  }
}
