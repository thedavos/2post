import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as bcrypt from "bcryptjs";

import { AuthService } from "./auth.service";

function makeDeps() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    session: {
      create: vi.fn().mockImplementation(({ data }) => ({
        id: "session-1",
        ...data,
      })),
      findUnique: vi.fn(),
      update: vi.fn().mockImplementation(({ data }) => ({
        id: "session-1",
        userId: "user-1",
        ...data,
        user: { id: "user-1", email: "owner@example.com", isActive: true },
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    orgMembership: {
      findFirst: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
    },
    apiKeyRateLimit: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(({ where }: { where: { scopeKey_windowStart: { scopeKey: string; windowStart: Date } } }) => ({
        scopeKey: where.scopeKey_windowStart.scopeKey,
        windowStart: where.scopeKey_windowStart.windowStart,
        count: 1,
      })),
    },
  };
  const jwt = { sign: vi.fn().mockReturnValue("access-token") };
  return { prisma, jwt: jwt as unknown as JwtService, service: new AuthService(prisma as never, jwt as unknown as JwtService, { sendPasswordReset: vi.fn(), sendInvitation: vi.fn(), send: vi.fn(), configured: false } as never) };
}

describe("AuthService", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  describe("login", () => {
    it("issues access + refresh tokens on valid credentials", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 4);
      deps.prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        passwordHash,
        isActive: true,
      });

      const result = await deps.service.login("owner@example.com", "correct-password");

      expect(result.accessToken).toBe("access-token");
      expect(result.refreshToken).toBeTruthy();
      expect(deps.prisma.session.create).toHaveBeenCalledOnce();
      expect(deps.prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "user-1" } }),
      );
    });

    it("rejects unknown emails without leaking existence", async () => {
      deps.prisma.user.findUnique.mockResolvedValue(null);
      await expect(deps.service.login("nobody@example.com", "x")).rejects.toThrow(
        new UnauthorizedException("Invalid email or password"),
      );
    });

    it("rejects wrong passwords", async () => {
      deps.prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        passwordHash: await bcrypt.hash("correct-password", 4),
        isActive: true,
      });
      await expect(
        deps.service.login("owner@example.com", "wrong-password"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects inactive users", async () => {
      deps.prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        passwordHash: await bcrypt.hash("pw", 4),
        isActive: false,
      });
      await expect(deps.service.login("owner@example.com", "pw")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe("refresh", () => {
    it("rotates the refresh token hash and extends expiry", async () => {
      deps.prisma.session.findUnique.mockResolvedValue({
        id: "session-1",
        userId: "user-1",
        refreshTokenHash: "old-hash",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: "user-1", email: "owner@example.com", isActive: true },
      });

      const result = await deps.service.refresh("raw-refresh-token");

      expect(result.accessToken).toBe("access-token");
      const updateCall = deps.prisma.session.update.mock.calls[0]![0];
      expect(updateCall.where.id).toBe("session-1");
      expect(updateCall.data.refreshTokenHash).not.toBe("old-hash");
      expect(updateCall.data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    });

    it("rejects revoked sessions", async () => {
      deps.prisma.session.findUnique.mockResolvedValue({
        id: "session-1",
        userId: "user-1",
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user: { isActive: true },
      });
      await expect(deps.service.refresh("raw")).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects expired sessions", async () => {
      deps.prisma.session.findUnique.mockResolvedValue({
        id: "session-1",
        userId: "user-1",
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: { isActive: true },
      });
      await expect(deps.service.refresh("raw")).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("logout", () => {
    it("revokes the session row", async () => {
      await deps.service.logout("raw");
      expect(deps.prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });
  });

  void BadRequestException;
});
