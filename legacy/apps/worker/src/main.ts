import { bootstrapWorker } from "@brightbean/api";

void bootstrapWorker().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
