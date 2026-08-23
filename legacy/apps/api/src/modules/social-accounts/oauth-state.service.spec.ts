import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { OauthStateService } from "./oauth-state.service";

process.env.SECRET_KEY = "test-secret-key-migration-fixture";

function makeDeps() {
  const prisma = {
    oauthConnectRequest: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  return { prisma, service: new OauthStateService(prisma as never) };
}

describe("OauthStateService", () => {
  let deps: ReturnType<typeof makeDeps>;
  const payload = {
    workspaceId: "ws-1",
    platform: "linkedin_company",
    userId: "user-1",
  };

  beforeEach(() => {
    deps = makeDeps();
  });

  it("round-trips a signed state and consumes the nonce once", async () => {
    deps.prisma.oauthConnectRequest.findUnique.mockResolvedValue({
      id: "req-1",
      nonceHash: "irrelevant",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const state = await deps.service.issue(payload);
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const consumed = await deps.service.consume(state);
    expect(consumed).toMatchObject({ workspaceId: "ws-1", platform: payload.platform });
    // single use — the row is deleted
    expect(deps.prisma.oauthConnectRequest.delete).toHaveBeenCalledWith({
      where: { id: "req-1" },
    });
  });

  it("rejects tampered payloads", async () => {
    const state = await deps.service.issue(payload);
    const [body] = state.split(".");
    const forged = `${body}${randomBytes(1).toString("base64url")}.forged-signature`;

    deps.prisma.oauthConnectRequest.findUnique.mockResolvedValue(null);
    void forged;
    expect(await deps.service.consume(`${body}.forged-signature`)).toBeNull();
  });

  it("rejects unknown nonces (no matching request row)", async () => {
    const state = await deps.service.issue(payload);
    deps.prisma.oauthConnectRequest.findUnique.mockResolvedValue(null);
    expect(await deps.service.consume(state)).toBeNull();
  });

  it("rejects expired request rows", async () => {
    const state = await deps.service.issue(payload);
    deps.prisma.oauthConnectRequest.findUnique.mockResolvedValue({
      id: "req-2",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await deps.service.consume(state)).toBeNull();
  });
});
