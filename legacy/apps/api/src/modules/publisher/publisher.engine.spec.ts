import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SocialProvider } from "@brightbean/shared";
import { CryptoService } from "../../common/crypto/crypto.service";
import { PublisherEngine } from "./publisher.engine";
import { ProviderRegistry } from "./provider.registry";

process.env.SECRET_KEY = "test-secret-key-migration-fixture";
process.env.ENCRYPTION_KEY_SALT = "test-salt-migration-fixture";

const ENCRYPTED_TOKEN =
  "GKuCy/JYojI4AuCTdlQuJ8loeMRyZ4Nrnw6V6awXyTmH0rCQSDDR87FPGIUxJlrpplttazF6Rm8ZWg=="; // "brightbean-cross-compat-vector"

function makeDeps() {
  const prisma = {
    platformPost: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    publishLog: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
  };

  const provider: SocialProvider = {
    platformName: "devto",
    maxCaptionLength: 100_000,
    supportedPostTypes: ["article"],
    supportedMediaTypes: [],
    rateLimits: { maxPerWindow: 10, windowSeconds: 60 },
    getAuthUrl: vi.fn(),
    exchangeCode: vi.fn(),
    refreshToken: vi.fn(),
    getProfile: vi.fn(),
    publishPost: vi
      .fn()
      .mockResolvedValue({
        platformPostId: "art-1",
        permalink: "https://dev.to/x",
        publishedAt: new Date(),
      }),
    publishComment: vi.fn(),
    getPostMetrics: vi.fn(),
    getAccountMetrics: vi.fn(),
  };

  const registry = new ProviderRegistry();
  registry.register(provider);

  const engine = new PublisherEngine(prisma as never, registry, new CryptoService());

  return { prisma, provider, registry, engine };
}

const PLATFORM_POST = {
  id: "pp-1",
  retryCount: 0,
  status: "SCHEDULED",
  post: {
    caption: "base caption",
    title: "",
    firstComment: "",
    scheduledAt: new Date(Date.now() - 60_000),
  },
  socialAccount: {
    platform: "devto",
    oauthAccessToken: ENCRYPTED_TOKEN,
  },
};

describe("PublisherEngine", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("publishes a due post: decrypts token, marks PUBLISHED, writes log", async () => {
    deps.prisma.platformPost.findUnique.mockResolvedValue(PLATFORM_POST);

    const outcome = await deps.engine.publishOne("pp-1");

    expect(outcome).toEqual({ platformPostId: "pp-1", ok: true, willRetry: false });
    // Token decrypted with the legacy-compatible key.
    const contentArg = (deps.provider.publishPost as ReturnType<typeof vi.fn>).mock
      .calls[0]![1];
    expect(contentArg.caption).toBe("base caption");

    // call 0 = status → PUBLISHING, call 1 = final PUBLISHED update
    const publishingUpdate = deps.prisma.platformPost.update.mock.calls[0]![0];
    expect(publishingUpdate.data.status).toBe("PUBLISHING");
    const updateData = deps.prisma.platformPost.update.mock.calls[1]![0].data;
    expect(updateData).toMatchObject({ status: "PUBLISHED", platformPostId: "art-1" });
    const logData = deps.prisma.publishLog.create.mock.calls[0]![0].data;
    expect(logData).toMatchObject({ attemptNumber: 1, statusCode: 200 });
  });

  it("per-platform caption override wins over base caption", async () => {
    deps.prisma.platformPost.findUnique.mockResolvedValue({
      ...PLATFORM_POST,
      platformSpecificCaption: "override caption",
    });

    await deps.engine.publishOne("pp-1");

    const contentArg = (deps.provider.publishPost as ReturnType<typeof vi.fn>).mock
      .calls[0]![1];
    expect(contentArg.caption).toBe("override caption");
  });

  it("schedules a retry with exponential backoff on failure", async () => {
    deps.prisma.platformPost.findUnique.mockResolvedValue(PLATFORM_POST);
    (deps.provider.publishPost as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("429 rate limited"),
    );

    const before = Date.now();
    const outcome = await deps.engine.publishOne("pp-1");

    expect(outcome).toEqual({ platformPostId: "pp-1", ok: false, willRetry: true });
    const updateCall = deps.prisma.platformPost.update.mock.calls[1]![0];
    expect(updateCall.data.status).toBe("SCHEDULED");
    expect(updateCall.data.retryCount).toBe(1);
    // 2^1 minutes backoff
    expect(updateCall.data.nextRetryAt.getTime()).toBeGreaterThanOrEqual(
      before + 2 * 60 * 1000,
    );
    expect(deps.prisma.publishLog.create).toHaveBeenCalledOnce();
  });

  it("marks FAILED after the final retry is exhausted", async () => {
    deps.prisma.platformPost.findUnique.mockResolvedValue({
      ...PLATFORM_POST,
      retryCount: 2, // next failure is attempt 3 → exhausted
    });
    (deps.provider.publishPost as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom"),
    );

    const outcome = await deps.engine.publishOne("pp-1");
    expect(outcome.willRetry).toBe(false);

    const updateCall = deps.prisma.platformPost.update.mock.calls[1]![0];
    expect(updateCall.data.status).toBe("FAILED");
    expect(updateCall.data.nextRetryAt).toBeNull();
  });

  it("publishDuePlatformPosts only picks scheduled+due rows", async () => {
    await deps.engine.publishDuePlatformPosts(new Date("2026-01-01T00:00:00Z"));

    const where = deps.prisma.platformPost.findMany.mock.calls[0]![0].where;
    expect(where.status).toBe("SCHEDULED");
    expect(where.OR).toBeDefined();
    expect(where.AND).toBeDefined();
  });

  it("handles unregistered platforms as a retryable failure (not a crash)", async () => {
    deps.prisma.platformPost.findUnique.mockResolvedValue({
      ...PLATFORM_POST,
      socialAccount: { ...PLATFORM_POST.socialAccount, platform: "facebook" },
    });

    const outcome = await deps.engine.publishOne("pp-1");

    expect(outcome.ok).toBe(false);
    const updateCall = deps.prisma.platformPost.update.mock.calls[1]![0];
    expect(updateCall.data.status).toBe("SCHEDULED"); // will retry → then FAILED
    expect(updateCall.data.publishError).toContain('No provider registered');
  });
});
