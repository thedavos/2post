import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";

import { CryptoModule } from "./common/crypto/crypto.module";
import { StorageModule } from "./common/storage/storage.module";
import { JobsModule } from "./jobs/jobs.module";
import { PrismaModule } from "./prisma/prisma.module";

/**
 * Worker process module: same domain services as the API, no HTTP surface.
 * Mirrors the legacy `python manage.py process_tasks` dyno.
 */
@Module({
  imports: [PrismaModule, CryptoModule, StorageModule, JobsModule],
})
export class WorkerModule {}

export async function bootstrapWorker(): Promise<void> {
  process.env.WORKER_MODE = "true";
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();

  // Nest application contexts don't keep the event loop alive on their own;
  // hold a handle so schedules continue until SIGTERM.
  const keepAlive = setInterval(() => {}, 60_000);
  const shutdown = () => {
    clearInterval(keepAlive);
    void app.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
