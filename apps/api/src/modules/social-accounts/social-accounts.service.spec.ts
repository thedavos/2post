import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SocialProvider } from "@brightbean/shared";
import { CryptoService } from "../../common/crypto/crypto.service";
import { ProviderRegistry } from "../publisher/provider.registry";
import { SocialAccountsService } from "./social-accounts.service";

process.env.SECRET_KEY = "test-secret-key-migration-fixture";
process.env.ENCRYPTION_KEY_SALT = "test-salt-migration-fixture";

const ENCRYPTED_TOKEN =
  "GKuCy/JYojI4AuCTdlQuJ8loeMRyZ4Nrnw6V6awXyTmH0rCQSDDR87FPGIUxJlrpplttazF6Rm8ZWg==";

const PROFILE = {
  platformAccountId: "pg-1",
  username: "beanpage",
  displayName: "Bean Page",
  avatarUrl: "https://img/a.png",
  followers: 120,
};

function makeDeps() {
  const prisma = {
    workspaceMembership: { findUnique: vi.fn() },
    orgMembership: { findUnique: vi.fn() },
    socialAccount: {
      upsert: vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => ({ id: "sa-1", ...create })),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    },
    workspace: { findUnique: vi.fn() },
  };

  const provider: SocialProvider & { revokeToken?: (t: string) => Promise<boolean> } = {
    platformName: "facebook",
    maxCaptionLength: 63_206,
    supportedPostTypes: ["text"],
    supportedMediaTypes: ["image"],
    rateLimits: { maxPerWindow: 1, windowSeconds: 1 },
    getAuthUrl: vi.fn().mockReturnValue("https://auth"),
    exchangeCode: vi.fn(),
    refreshToken: vi.fn(),
    getProfile: vi.fn().mockResolvedValue(PROFILE),
    publishPost: vi.fn(),
    publishComment: vi.fn(),
    getPostMetrics: vi.fn(),
    getAccountMetrics: vi.fn(),
    revokeToken: vi.fn().mockResolvedValue(true),
  };

  const registry = new ProviderRegistry();
  registry.register(provider);

  const service = new SocialAccountsService(prisma as never, registry, new CryptoService());
  return { prisma, provider, registry, service };
}

describe("SocialAccountsService", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  describe("connectWithCredentials (bluesky/devto)", () => {
    it("creates the account with an encrypted access token", async () => {
      deps.prisma.workspaceMembership.findUnique.mockResolvedValue({
        workspaceRole: "EDITOR",
      });
      const bluesky = {
        ...deps.provider,
        platformName: "bluesky" as const,
        createSession: vi
          .fn()
          .mockResolvedValue({ accessToken: "raw-access", refreshToken: "raw-refresh" }),
      };
      bluesky.getProfile = vi.fn().mockResolvedValue({
        ...PROFILE,
        platformAccountId: "did:plc:x",
        username: "bean.bsky.social",
      });
      // replace provider in registry
      (bluesky as { platformName: string }).platformName = "bluesky";
      const registry2 = new ProviderRegistry();
      registry2.register(bluesky);
      const service = new SocialAccountsService(
        deps.prisma as never,
        registry2,
        new CryptoService(),
      );

      await service.connectWithCredentials("u1", "ws-1", "bluesky", {
        handle: "bean.bsky.social",
        appPassword: "xxx-yyy",
      });

      const created = deps.prisma.socialAccount.upsert.mock.calls[0]![0].create;
      expect(created.accountHandle).toBe("bean.bsky.social");
      // token stored encrypted — never the raw value
      expect(created.oauthAccessToken).not.toBe("raw-access");
      expect(() => new CryptoService().decrypt(created.oauthAccessToken)).not.toThrow();

      const updateArg = deps.prisma.socialAccount.upsert.mock.calls[0]![0].update;
      expect(updateArg.connectionStatus).toBe("CONNECTED");
    });

    it("denies members without manage_social_accounts", async () => {
      deps.prisma.workspaceMembership.findUnique.mockResolvedValue({
        workspaceRole: "VIEWER",
      });
      await expect(
        deps.service.connectWithCredentials("u1", "ws-1", "devto", { apiKey: "k" }),
      ).rejects.toThrow(/permission to manage social accounts/);
    });
  });

  describe("disconnect", () => {
    it("revokes platform-side then deletes the row", async () => {
      deps.prisma.socialAccount.findUnique.mockResolvedValue({
        id: "sa-1",
        platform: "facebook",
        oauthAccessToken: ENCRYPTED_TOKEN, // decrypts to the cross-compat vector
        workspace: { organizationId: "org-1" },
      });
      deps.prisma.orgMembership.findUnique.mockResolvedValue({ orgRole: "OWNER" });

      await deps.service.disconnect("u1", "sa-1");

      // revocation received the decrypted token
      expect((deps.provider.revokeToken as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
        "brightbean-cross-compat-vector",
      );
      expect(deps.prisma.socialAccount.delete).toHaveBeenCalledWith({
        where: { id: "sa-1" },
      });
    });

    it("deletes even when platform revocation fails (never blocks)", async () => {
      deps.prisma.socialAccount.findUnique.mockResolvedValue({
        id: "sa-1",
        platform: "facebook",
        oauthAccessToken: ENCRYPTED_TOKEN,
        workspace: { organizationId: "org-1" },
      });
      deps.prisma.orgMembership.findUnique.mockResolvedValue({ orgRole: "OWNER" });
      (
        deps.provider as { revokeToken?: (t: string) => Promise<boolean> }
      ).revokeToken = vi.fn().mockRejectedValue(new Error("platform down"));

      await expect(deps.service.disconnect("u1", "sa-1")).resolves.toBeUndefined();
      expect(deps.prisma.socialAccount.delete).toHaveBeenCalledOnce();
    });
  });
});
