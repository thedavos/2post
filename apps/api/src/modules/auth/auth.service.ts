import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import * as bcrypt from "bcryptjs";

import { PrismaService } from "../../prisma/prisma.service";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  type AccessTokenClaims,
  REFRESH_TTL_SECONDS,
} from "./auth.constants";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user?.passwordHash || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueSession(user.id, user.email);
  }

  /** Rotates the refresh token (sliding session) and returns new cookies payload. */
  async refresh(rawRefreshToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(rawRefreshToken) },
      include: { user: true },
    });

    if (!session || !session.user.isActive || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException("Session expired");
    }

    return this.rotateSession(session);
  }

  async logout(rawRefreshToken: string | undefined) {
    if (rawRefreshToken) {
      await this.revoke(rawRefreshToken);
    }
  }

  signAccessToken(claims: AccessTokenClaims): string {
    return this.jwt.sign(claims, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  }

  private async issueSession(userId: string, email: string) {
    const refreshToken = randomBytes(48).toString("base64url");

    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      },
    });

    const activeOrgId = await this.resolveDefaultOrg(userId);

    return {
      accessToken: this.signAccessToken({ sub: userId, email, activeOrgId }),
      refreshToken,
      sessionId: session.id,
      activeOrgId,
    };
  }

  private async rotateSession(session: { id: string; userId: string }) {
    const refreshToken = randomBytes(48).toString("base64url");

    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
        lastUsedAt: new Date(),
      },
      include: { user: true },
    });

    if (!updated.user.isActive) {
      throw new UnauthorizedException("Session expired");
    }

    const activeOrgId = await this.resolveDefaultOrg(updated.userId);

    return {
      accessToken: this.signAccessToken({
        sub: updated.userId,
        email: updated.user.email,
        activeOrgId,
      }),
      refreshToken,
      sessionId: updated.id,
      activeOrgId,
    };
  }

  private async revoke(rawRefreshToken: string) {
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: sha256(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /// Legacy auto-provisioned one default org per user; users with several orgs
  /// get the most recently used one once workspace activity tracking lands.
  private async resolveDefaultOrg(userId: string): Promise<string | null> {
    const membership = await this.prisma.orgMembership.findFirst({
      where: { userId, organization: { deletionScheduledAt: null } },
      orderBy: { createdAt: "asc" },
      select: { organizationId: true },
    });
    return membership?.organizationId ?? null;
  }
}
