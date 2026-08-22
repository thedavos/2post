import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";

import { CryptoModule } from "./common/crypto/crypto.module";
import { PublisherModule } from "./modules/publisher/publisher.module";
import { PrismaModule } from "./prisma/prisma.module";

/**
 * Worker process module: same domain services as the API, no HTTP surface.
 * Mirrors the legacy `python manage.py process_tasks` dyno.
 */
@Module({
  imports: [PrismaModule, CryptoModule, PublisherModule],
})
export class WorkerModule {}

export async function bootstrapWorker(): Promise<void> {
  process.env.WORKER_MODE = "true";
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();
}
