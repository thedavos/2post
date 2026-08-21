import PgBoss from "pg-boss";

/**
 * Phase 0 bootstrap: boots pg-boss against PostgreSQL.
 * Job processors are ported module-by-module in later phases —
 * schedule parity table lives in docs/migration/03-backend-nestjs.md §4.
 */
const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/brightbean";

async function main() {
  const boss = new PgBoss({ connectionString });

  boss.on("error", (error) => console.error("[pg-boss]", error));

  await boss.start();

  await boss.createQueue("healthcheck");
  await boss.work("healthcheck", async () => {
    // Placeholder processor proving the queue loop works end to end.
  });
  await boss.send("healthcheck", {});

  console.log("[worker] pg-boss started");
}

void main();
