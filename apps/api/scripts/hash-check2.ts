import { createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { PrismaClient } from "../generated/prisma";

async function main() {
  const p = new PrismaClient({
    datasources: { db: { url: "postgres://postgres:e2e@localhost:5433/brightbean_e2e" } },
  });
  const user = await p.user.findUniqueOrThrow({
    where: { email: "e2e-parity@brightbean.test" },
  });
  const full = user.passwordHash!;
  const token = "$" + full.match(/(2[abcy]\$\d{2}\$[./A-Za-z0-9]+)$/)?.[1];
  console.log("token:", token);

  const pw = "parity-suite-password";
  const digestRaw = createHash("sha256").update(pw, "utf8").digest(); // 32 bytes
  const candidates: Record<string, string> = {
    b64raw_padded: Buffer.from(digestRaw).toString("base64"),
    b64raw_nopad: Buffer.from(digestRaw).toString("base64").replace(/=+$/, ""),
    hex: Buffer.from(createHash("sha256").update(pw).digest("hex")).toString(),
    b64hex: Buffer.from(createHash("sha256").update(pw).digest("hex")).toString("base64"),
  };
  for (const [name, digest] of Object.entries(candidates)) {
    const ok = await bcrypt.compare(digest, token).catch(() => `ERR`);
    console.log(name, "→", ok);
  }
  await p.$disconnect();
}
main();
