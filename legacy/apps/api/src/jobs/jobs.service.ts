import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import PgBoss from "pg-boss";

import { CryptoService } from "../common/crypto/crypto.service";
import { PrismaService } from "../prisma/prisma.service";
import { PublisherEngine } from "../modules/publisher/publisher.engine";
import { ProviderRegistry } from "../modules/publisher/provider.registry";
import { cronFromSeconds, JOB_SCHEDULES, type JobName } from "./jobs.constants";

/**
 * Central pg-boss lifecycle — parity with the django-background-tasks
 * registrations from each legacy Django app config. Schedules live in
 * jobs.constants.ts.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobsService.name);
  private boss?: PgBoss;

  constructor(
    // Explicit @Inject keeps DI stable under any transpiler (tsx/swc).
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(PublisherEngine) private readonly publisherEngine: PublisherEngine,
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.WORKER_MODE !== "true") return;

    const connectionString =
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/brightbean_next";

    this.boss = new PgBoss({ connectionString });
    this.boss.on("error", (error: Error) => this.logger.error(`[pg-boss] ${error.message}`));
    await this.boss.start();

    for (const [name, cfg] of Object.entries(JOB_SCHEDULES)) {
      await this.boss.createQueue(name);
      if (cfg.implemented) {
        await this.boss.work(name, async () => {
        await this.runJob(name as JobName);
      });
      } else {
        // Placeholder worker so the schedule exists and its phase is visible.
        await this.boss.work(name, async () => {
          this.logger.warn(`[jobs] ${name} processor not implemented yet (pending phase)`);
        });
      }
      await this.boss.schedule(name, cronFromSeconds(cfg.seconds));
    }

    this.logger.log(
      `Registered ${Object.keys(JOB_SCHEDULES).length} recurring jobs ` +
        `(implemented: ${
          Object.values(JOB_SCHEDULES).filter((j) => j.implemented).length
        })`,
    );
  }

  /** Runs one job by name — also used directly by unit tests. */
  async runJob(name: JobName): Promise<void> {
    if (process.env.JOBS_DEBUG) {
    }
    switch (name) {
      case "publish-due-posts": {
        const outcomes = await this.publisherEngine.publishDuePlatformPosts();
        if (outcomes.length > 0) {
          this.logger.log(`published ${outcomes.length} due posts`);
        }
        return;
      }
      case "session-cleanup":
        return this.sessionCleanup();
      case "oauth-token-refresh":
        return this.oauthTokenRefresh();
      case "idempotency-sweep":
        return; // no idempotency table yet — lands with API contract phase
      default:
        this.logger.warn(`${name} pending implementation`);
    }
  }

  /// Legacy clear_expired_sessions parity.
  private async sessionCleanup(): Promise<void> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) this.logger.log(`cleaned ${result.count} expired sessions`);
  }

  /// Refresh OAuth tokens expiring within 24h (legacy social_accounts task).
  private async oauthTokenRefresh(): Promise<void> {
    const cutoff = new Date(Date.now() + 24 * 3600 * 1000);
    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        connectionStatus: "CONNECTED",
        oauthRefreshToken: { not: null },
        tokenExpiresAt: { lte: cutoff },
      },
    });

    let refreshed = 0;
    for (const account of accounts) {
      try {
        const provider = this.registry.get(account.platform) as unknown as {
          refreshToken?: (t: string) => Promise<{
            accessToken: string;
            refreshToken?: string;
            expiresAt?: Date | null;
          }>;
        };
        if (typeof provider.refreshToken !== "function" || !account.oauthRefreshToken) continue;

        const tokens = await provider.refreshToken(
          this.crypto.decrypt(account.oauthRefreshToken),
        );

        await this.prisma.socialAccount.update({
          where: { id: account.id },
          data: {
            oauthAccessToken: this.crypto.encrypt(tokens.accessToken),
            ...(tokens.refreshToken
              ? { oauthRefreshToken: this.crypto.encrypt(tokens.refreshToken) }
              : {}),
            ...(tokens.expiresAt ? { tokenExpiresAt: tokens.expiresAt } : {}),
            connectionStatus: "CONNECTED",
          },
        });
        refreshed += 1;
      } catch (error) {
        this.logger.warn(
          `token refresh failed for account ${account.id} (${account.platform}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.prisma.socialAccount.update({
          where: { id: account.id },
          data: { connectionStatus: "ERROR" },
        });
      }
    }
    if (refreshed > 0) this.logger.log(`refreshed ${refreshed} tokens`);
  }
}
