import { Injectable, Logger } from "@nestjs/common";

import type { PostContent } from "@brightbean/shared";
import { CryptoService } from "../../common/crypto/crypto.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderRegistry } from "./provider.registry";

/// Parity with legacy publisher engine retry policy.
const MAX_RETRIES = 3;

export interface PublishOutcome {
  platformPostId: string;
  ok: boolean;
  willRetry: boolean;
}

@Injectable()
export class PublisherEngine {
  private readonly logger = new Logger(PublisherEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly crypto: CryptoService,
  ) {}

  /// Called by the pg-boss job every 15 seconds (legacy cadence).
  async publishDuePlatformPosts(now: Date = new Date()): Promise<PublishOutcome[]> {
    const due = await this.prisma.platformPost.findMany({
      where: {
        status: "SCHEDULED",
        OR: [
          { scheduledAt: { lte: now } },
          { scheduledAt: null, post: { scheduledAt: { lte: now } } },
        ],
        AND: [{ OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] }],
      },
      include: {
        post: true,
        socialAccount: true,
      },
      take: 25, // bounded batch per tick
    });

    const outcomes: PublishOutcome[] = [];
    for (const pp of due) {
      try {
        outcomes.push(await this.publishOne(pp.id));
      } catch (error) {
        // publishOne handles its own failures; a throw here is a bug —
        // log and continue so one bad row doesn't stall the queue.
        this.logger.error(`Unexpected failure publishing ${pp.id}`, error);
      }
    }
    return outcomes;
  }

  async publishOne(platformPostId: string): Promise<PublishOutcome> {
    const pp = await this.prisma.platformPost.findUnique({
      where: { id: platformPostId },
      include: { post: true, socialAccount: true },
    });
    if (!pp) throw new Error("PlatformPost not found");

    const startedAt = Date.now();
    await this.prisma.platformPost.update({
      where: { id: pp.id },
      data: { status: "PUBLISHING" },
    });

    const attemptNumber =
      (await this.prisma.publishLog.count({ where: { platformPostId: pp.id } })) + 1;

    try {
      const provider = this.registry.get(pp.socialAccount.platform);
      const accessToken = this.decryptToken(pp.socialAccount.oauthAccessToken);

      const content: PostContent = {
        caption: pp.platformSpecificCaption ?? pp.post.caption,
        title: pp.platformSpecificTitle ?? (pp.post.title || undefined),
        firstComment:
          pp.platformSpecificFirstComment ?? (pp.post.firstComment || undefined),
        media: [],
      };

      const result = await provider.publishPost(accessToken, content);

      await this.prisma.platformPost.update({
        where: { id: pp.id },
        data: {
          status: "PUBLISHED",
          platformPostId: result.platformPostId,
          publishedAt: result.publishedAt,
          publishError: "",
          retryCount: 0,
          nextRetryAt: null,
        },
      });
      await this.prisma.publishLog.create({
        data: {
          platformPostId: pp.id,
          attemptNumber,
          statusCode: 200,
          responseBody: JSON.stringify({ permalink: result.permalink }).slice(0, 1000),
          durationMs: Date.now() - startedAt,
        },
      });

      return { platformPostId: pp.id, ok: true, willRetry: false };
    } catch (error) {
      return this.handleFailure(pp.id, pp.retryCount, error, startedAt, attemptNumber);
    }
  }

  private async handleFailure(
    platformPostId: string,
    retryCount: number,
    error: unknown,
    startedAt: number,
    attemptNumber: number,
  ): Promise<PublishOutcome> {
    const message = error instanceof Error ? error.message : String(error);
    const nextRetryCount = retryCount + 1;
    const exhausted = nextRetryCount >= MAX_RETRIES;

    // Exponential backoff: 2^n minutes (legacy parity).
    const nextRetryAt = new Date(Date.now() + Math.pow(2, nextRetryCount) * 60 * 1000);

    await this.prisma.platformPost.update({
      where: { id: platformPostId },
      data: {
        status: exhausted ? "FAILED" : "SCHEDULED",
        publishError: message.slice(0, 2000),
        retryCount: nextRetryCount,
        nextRetryAt: exhausted ? null : nextRetryAt,
      },
    });
    await this.prisma.publishLog.create({
      data: {
        platformPostId,
        attemptNumber,
        errorMessage: message.slice(0, 1000),
        durationMs: Date.now() - startedAt,
      },
    });

    this.logger.warn(
      `Publish failed for ${platformPostId} (attempt ${attemptNumber})${exhausted ? " — marked FAILED" : `, retry at ${nextRetryAt.toISOString()}`}`,
    );

    return { platformPostId, ok: false, willRetry: !exhausted };
  }

  private decryptToken(encrypted: string | null): string {
    if (!encrypted) throw new Error("Social account has no stored access token");
    return this.crypto.decrypt(encrypted);
  }
}
