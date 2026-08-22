import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "../src/worker";
import { JobsService } from "../src/jobs/jobs.service";

async function main() {
  process.env.WORKER_MODE = "true";
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error"],
  });
  const jobs = app.get(JobsService);
  const prisma = app.get((await import("../src/prisma/prisma.service")).PrismaService);
  console.log("[smoke] prisma keys has session:", "session" in prisma);

  console.log("[smoke] session-cleanup…");
  await jobs.runJob("session-cleanup");

  console.log("[smoke] oauth-token-refresh…");
  await jobs.runJob("oauth-token-refresh");

  console.log("[smoke] idempotency-sweep…");
  await jobs.runJob("idempotency-sweep");

  console.log("[smoke] publish-due-posts…");
  await jobs.runJob("publish-due-posts");

  console.log("[smoke] OK");
  await app.close();
  process.exit(0);
}
main().catch((e) => {
  console.error("[smoke] FAILED:", e?.message ?? e);
  process.exit(1);
});
