/**
 * E2E seed: connects a dev.to account to the seeded user's workspace.
 * Run: DATABASE_URL=… pnpm --filter @brightbean/api exec tsx scripts/seed-e2e.ts
 */
import { PrismaClient } from "../generated/prisma";
import { CryptoService } from "../src/common/crypto/crypto.service";

const crypto = new CryptoService();
const prisma = new PrismaClient();

async function main() {
  const email = "e2e-parity@brightbean.test";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Run the signup flow first");

  const membership = await prisma.orgMembership.findFirstOrThrow({
    where: { userId: user.id },
    include: { organization: { include: { workspaces: true } } },
  });
  const workspaceId = membership.organization.workspaces[0]!.id;

  await prisma.socialAccount.upsert({
    where: {
      workspaceId_platform_accountPlatformId: {
        workspaceId,
        platform: "devto",
        accountPlatformId: "e2e-devto",
      },
    },
    create: {
      workspaceId,
      platform: "devto",
      accountPlatformId: "e2e-devto",
      accountName: "E2E DEV.to",
      accountHandle: "e2e",
      oauthAccessToken: crypto.encrypt("e2e-test-token"),
      connectionStatus: "CONNECTED",
    },
    update: {},
  });

  console.log("Seeded devto account on workspace", workspaceId);
}

main().finally(() => prisma.$disconnect());
