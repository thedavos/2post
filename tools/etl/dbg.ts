import { PrismaClient } from "../../apps/api/generated/prisma";
const d = new PrismaClient();
console.log("models sample:", ["users","organization","socialAccount"].map(k => `${k}=${typeof (d as never as Record<string, unknown>)[k]}`).join(","));
process.exit(0);
