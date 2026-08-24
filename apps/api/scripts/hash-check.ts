import { PrismaClient } from "../generated/prisma";
import { verifyPassword } from "../src/modules/auth/password.crypto";

const p = new PrismaClient({
  datasources: { db: { url: "postgres://postgres:e2e@localhost:5433/brightbean_e2e" } },
});

async function main() {
const user = await p.user.findUniqueOrThrow({
  where: { email: "e2e-parity@brightbean.test" },
});
console.log("HASH:", user.passwordHash?.slice(0, 45));
console.log("verify correct:", await verifyPassword("parity-suite-password", user.passwordHash!));
console.log("verify wrong:  ", await verifyPassword("nope", user.passwordHash!));
await p.$disconnect();
}
main();
