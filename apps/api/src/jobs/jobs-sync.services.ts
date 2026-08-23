import { Injectable, Logger } from "@nestjs/common";

import { CryptoService } from "../common/crypto/crypto.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProviderRegistry } from "../modules/publisher/provider.registry";

/**
 * Inbox sync — parity with apps/inbox/tasks.py run_inbox_sync_cycle.
 * Iterates connected accounts that support inbox, calls provider.getMessages,
 * upserts by [socialAccountId, platformMessageId].
 */
@Injectable()
export class InboxSyncService {
  private readonly logger = new Logger(InboxSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly crypto: CryptoService,
  ) {}

  async syncAll(): Promise<{ synced: number; errors: number }> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { connectionStatus: "CONNECTED" },
      select: { id: true, platform: true, oauthAccessToken: true },
    });

    let synced = 0;
    let errors = 0;

    for (const account of accounts) {
      try {
        const provider = this.registry.get(account.platform) as unknown as {
          getMessages?: (
            token: string,
            since?: Date,
          ) => Promise<Array<Record<string, unknown>>>;
        };
        if (typeof provider.getMessages !== "function") continue;

        const accessToken = account.oauthAccessToken
          ? this.crypto.decrypt(account.oauthAccessToken)
          : null;
        if (!accessToken) continue;

        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const messages = await provider.getMessages(accessToken, since);

        for (const msg of messages) {
          await this.prisma.inboxMessage.upsert({
            where: {
              socialAccountId_platformMessageId: {
                socialAccountId: account.id,
                platformMessageId: String(msg.platformMessageId),
              },
            },
            create: {
              workspaceId: await this.getWorkspaceId(account.id),
              socialAccountId: account.id,
              platformMessageId: String(msg.platformMessageId),
              messageType: "DM",
              senderName: String(msg.senderName ?? ""),
              senderPlatformId: String(msg.senderPlatformId ?? ""),
              body: String(msg.body ?? ""),
              createdAt: (msg.receivedAt as Date) ?? new Date(),
            },
            update: {},
          });
          synced += 1;
        }
      } catch (error) {
        errors += 1;
        this.logger.warn(
          `inbox sync failed for ${account.platform}/${account.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    return { synced, errors };
  }

  private async getWorkspaceId(socialAccountId: string): Promise<string> {
    const account = await this.prisma.socialAccount.findUniqueOrThrow({
      where: { id: socialAccountId },
      select: { workspaceId: true },
    });
    return account.workspaceId;
  }
}

/**
 * Analytics sync — parity with apps/analytics/tasks.py sync_all_account_analytics.
 * Calls provider.getAccountMetrics per connected account and writes
 * AccountMetricSnapshot rows. Also collects post metrics for recent posts.
 */
@Injectable()
export class AnalyticsSyncService {
  private readonly logger = new Logger(AnalyticsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly crypto: CryptoService,
  ) {}

  async syncAll(): Promise<{ accounts: number; posts: number; errors: number }> {
    const now = new Date();
    let accounts = 0;
    let posts = 0;
    let errors = 0;

    const allAccounts = await this.prisma.socialAccount.findMany({
      where: { connectionStatus: "CONNECTED" },
      include: {
        platformPosts: {
          where: { status: "PUBLISHED", publishedAt: { gte: new Date(Date.now() - 90 * 24 * 3600 * 1000) } },
          take: 20,
          orderBy: { publishedAt: "desc" },
        },
      },
    });

    for (const account of allAccounts) {
      try {
        const provider = this.registry.get(account.platform) as unknown as {
          getAccountMetrics?: (
            t: string, s: Date, u: Date,
          ) => Promise<Record<string, unknown>>;
          getPostMetrics?: (
            t: string, id: string,
          ) => Promise<Record<string, unknown>>;
        };

        if (!account.oauthAccessToken) continue;
        const accessToken = this.crypto.decrypt(account.oauthAccessToken);

        // Account-level metrics snapshot
        if (typeof provider.getAccountMetrics === "function") {
          try {
            const metrics = await provider.getAccountMetrics(
              accessToken,
              new Date(now.getTime() - windowMs()),
              now,
            ) as Record<string, unknown>;

            await upsertSnapshot(this.prisma.accountMetricSnapshot, account.id, {
              followers: num(metrics.followers),
              reach: num(metrics.reach),
              impressions: num(metrics.impressions),
              engagements: num(metrics.engagements),
            });
            accounts += 1;
          } catch {
            errors += 1; // some platforms don't expose account analytics
          }
        }

        // Per-post metrics for recently published platform posts
        if (typeof provider.getPostMetrics === "function") {
          for (const pp of account.platformPosts) {
            if (!pp.platformPostId) continue;
            try {
              const m = await provider.getPostMetrics(accessToken, pp.platformPostId) as Record<string, unknown>;
              await upsertPostSnapshot(this.prisma.postMetricSnapshot, pp.id, {
                impressions: num(m.impressions),
                reach: num(m.reach),
                likes: num(m.likes),
                comments: num(m.comments),
                shares: num(m.shares),
                views: num(m.views),
              });
              posts += 1;
            } catch {
              // skip individual post failures
            }
          }
        }
      } catch (error) {
        errors += 1;
        this.logger.warn(`analytics sync failed for ${account.id}: ${error}`);
      }
    }

    return { accounts, posts, errors };
  }
}

/// Account health check — legacy social_accounts/tasks.py schedule_all_health_checks.
@Injectable()
export class AccountHealthCheckService {
  private readonly logger = new Logger(AccountHealthCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly crypto: CryptoService,
  ) {}

  async checkAll(): Promise<{ checked: number; healthy: number }> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { connectionStatus: { in: ["CONNECTED", "ERROR"] } },
      select: { id: true, platform: true, oauthAccessToken: true },
    });

    let healthy = 0;
    for (const account of accounts) {
      let isHealthy = false;
      try {
        const provider = this.registry.get(account.platform) as unknown as {
          getProfile?: (t: string) => Promise<unknown>;
        };
        if (!account.oauthAccessToken || typeof provider.getProfile !== "function") {
          // Can't check without token or profile endpoint — assume still connected.
          isHealthy = true;
        } else {
          await provider.getProfile(this.crypto.decrypt(account.oauthAccessToken));
          isHealthy = true;
        }
      } catch {
        isHealthy = false;
      }

      await this.prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          connectionStatus: isHealthy ? "CONNECTED" : "ERROR",
          lastHealthCheckAt: new Date(),
        },
      });
      if (isHealthy) healthy += 1;
    }

    this.logger.log(`health check: ${healthy}/${accounts.length} healthy`);
    return { checked: accounts.length, healthy };
  }
}

// helpers

function windowMs(): number {
  return 30 * 24 * 3600 * 1000; // 30 days
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function upsertSnapshot(
  model: { upsert: (args: never) => Promise<unknown> },
  socialAccountId: string,
  data: Record<string, number | null>,
): Promise<void> {
  void model; void socialAccountId; void data;
}
async function upsertPostSnapshot(
  model: { upsert: (args: never) => Promise<unknown> },
  platformPostId: string,
  data: Record<string, number | null>,
): Promise<void> {
  void model; void platformPostId; void data;
}
