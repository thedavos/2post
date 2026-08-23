import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";
import type { SocialProvider } from "@brightbean/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { ProviderRegistry } from "../publisher/provider.registry";
import { CryptoService } from "../../common/crypto/crypto.service";

const updateSchema = z.object({
  status: z.enum(["UNREAD", "OPEN", "RESOLVED", "ARCHIVED"]).optional(),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]).optional(),
});

const replySchema = z.object({ body: z.string().min(1).max(5000) });

@UseGuards(JwtAuthGuard)
@Controller("api/app/workspaces/:workspaceId/inbox")
export class InboxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly registry: ProviderRegistry,
    private readonly crypto: CryptoService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Body() _body?: unknown,
  ) {
    void _body;
    await this.membership.requireWorkspace(user.sub, workspaceId);
    const results = await this.prisma.inboxMessage.findMany({
      where: { workspaceId },
      include: { socialAccount: { select: { platform: true, accountName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { results };
  }

  @Patch("messages/:messageId")
  async update(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Param("messageId") messageId: string,
    @Body() body: unknown,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);
    const input = updateSchema.parse(body);

    return this.prisma.inboxMessage.updateMany({
      where: { id: messageId, workspaceId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.sentiment ? { sentiment: input.sentiment } : {}),
      },
    });
  }

  /// Reply via the platform provider (publishComment) — parity with legacy
  /// reply flows that post through the connected account.
  @Post("messages/:messageId/reply")
  async reply(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Param("messageId") messageId: string,
    @Body() body: unknown,
  ) {
    await this.membership.requireWorkspace(user.sub, workspaceId);
    const input = replySchema.parse(body);

    const message = await this.prisma.inboxMessage.findFirst({
      where: { id: messageId, workspaceId },
      include: { socialAccount: true },
    });
    if (!message) throw new NotFoundException("Message not found");

    let provider: SocialProvider;
    try {
      provider = this.registry.get(message.socialAccount.platform);
    } catch {
      throw new ForbiddenException("Replies are not supported on this platform");
    }

    if (!message.socialAccount.oauthAccessToken) {
      throw new ForbiddenException("Account has no stored access token");
    }

    // Legacy providers throw for unsupported reply targets — surface as-is.
    const result = await provider.publishComment(
      this.crypto.decrypt(message.socialAccount.oauthAccessToken),
      message.platformMessageId,
      input.body,
    );

    const saved = await this.prisma.inboxReply.create({
      data: {
        messageId: message.id,
        userId: user.sub,
        body: input.body,
        platformReplyId: result.platformCommentId ?? null,
      },
    });

    // Marking replied-to threads OPEN mirrors legacy behavior.
    await this.prisma.inboxMessage.update({
      where: { id: message.id },
      data: { status: "OPEN" },
    });

    return saved;
  }
}
