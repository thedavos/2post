import { Module, type OnApplicationBootstrap } from "@nestjs/common";
import PgBoss from "pg-boss";

import { CryptoModule } from "../../common/crypto/crypto.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { DevtoProvider } from "./providers/devto.provider";
import { BlueskyProvider } from "./providers/bluesky.provider";
import { MastodonProvider } from "./providers/mastodon.provider";
import { PublisherEngine } from "./publisher.engine";
import { ProviderRegistry } from "./provider.registry";

export const PUBLISH_QUEUE = "publish-due-posts";

@Module({
  imports: [PrismaModule, CryptoModule],
  providers: [
    DevtoProvider,
    BlueskyProvider,
    MastodonProvider,
    {
      provide: ProviderRegistry,
      // Remaining in 2b: meta family (facebook, instagram, instagram_login,
      // threads), linkedin_personal/company, tiktok, youtube,
      // google_business, pinterest.
      useFactory: (
        devto: DevtoProvider,
        bluesky: BlueskyProvider,
        mastodon: MastodonProvider,
      ) => {
        const registry = new ProviderRegistry();
        registry.register(devto);
        registry.register(bluesky);
        registry.register(mastodon);
        return registry;
      },
      inject: [DevtoProvider, BlueskyProvider, MastodonProvider],
    },
    PublisherEngine,
  ],
  exports: [PublisherEngine, ProviderRegistry],
})
export class PublisherModule implements OnApplicationBootstrap {
  private boss?: PgBoss;

  constructor(private readonly engine: PublisherEngine) {}

  /**
   * When running inside the worker process (WORKER_MODE=true), starts pg-boss
   * and registers the 15-second publish cadence — parity with the legacy
   * django-background-tasks registration.
   */
  async onApplicationBootstrap() {
    if (process.env.WORKER_MODE !== "true") return;

    const connectionString =
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/brightbean_next";

    this.boss = new PgBoss({ connectionString });
    this.boss.on("error", (error: Error) => console.error("[pg-boss]", error));
    await this.boss.start();

    await this.boss.createQueue(PUBLISH_QUEUE);
    await this.boss.work(PUBLISH_QUEUE, async () => {
      const outcomes = await this.engine.publishDuePlatformPosts();
      if (outcomes.length > 0) {
        console.log(`[publisher] ${outcomes.length} due posts processed`);
      }
    });
    // Every 15 seconds.
    await this.boss.schedule(PUBLISH_QUEUE, "*/15 * * * * *");

    console.log("[publisher] pg-boss publish job scheduled every 15s");
  }
}
