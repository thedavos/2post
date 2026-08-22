import { Injectable, UnauthorizedException } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import { randomToken, sha256Hex } from "./oauth-crypto";

const ACCESS_TTL_SECONDS = 60 * 60; // 1 h
const REFRESH_TTL_DAYS = 60;
export const AUTH_CODE_TTL_SECONDS = 5 * 60;

@Injectable()
export class OAuthServerService {
  constructor(private readonly prisma: PrismaService) {}

  async requireApplication(clientId: string) {
    const app = await this.prisma.oAuthApplication.findUnique({
      where: { clientId },
    });
    if (!app) throw new UnauthorizedException("Unknown client");
    return app;
  }

  validateRedirectUri(
    app: { redirectUris: unknown },
    redirectUri: string,
  ): boolean {
    const uris = Array.isArray(app.redirectUris) ? (app.redirectUris as string[]) : [];
    return uris.includes(redirectUri);
  }

  /** Authorization-code issue: stores only the SHA-256 of the code. */
  async issueAuthCode(input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    scope: string;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
  }): Promise<string> {
    const code = randomToken(32);
    await this.prisma.oAuthAuthCode.create({
      data: {
        codeHash: sha256Hex(code),
        clientId: input.clientId,
        userId: input.userId,
        redirectUri: input.redirectUri,
        scope: input.scope,
        codeChallenge: input.codeChallenge ?? null,
        codeChallengeMethod: input.codeChallengeMethod ?? null,
        expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
      },
    });
    return code;
  }

  async exchangeAuthCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier?: string;
  }) {
    const codeHash = sha256Hex(input.code);
    const grant = await this.prisma.oAuthAuthCode.findUnique({
      where: { codeHash },
    });

    if (
      !grant ||
      grant.consumedAt ||
      grant.expiresAt < new Date() ||
      grant.clientId !== input.clientId ||
      grant.redirectUri !== input.redirectUri
    ) {
      throw new UnauthorizedException("invalid_grant");
    }

    // PKCE verification (RFC 7636).
    if (grant.codeChallenge) {
      const { verifyPkce } = await import("./oauth-crypto");
      const check = verifyPkce(
        grant.codeChallengeMethod ?? "S256",
        grant.codeChallenge,
        input.codeVerifier ?? "",
      );
      if (!check.ok) throw new UnauthorizedException(check.reason ?? "invalid_grant");
    } else {
      throw new UnauthorizedException("PKCE required for public clients");
    }

    // Single use — replay revokes everything issued from this code.
    await this.prisma.oAuthAuthCode.update({
      where: { id: grant.id },
      data: { consumedAt: new Date() },
    });

    return this.issueTokens({
      clientId: grant.clientId,
      userId: grant.userId,
      scope: grant.scope,
    });
  }

  /// Refresh grant with rotation: old token revoked, new pair issued.
  async rotateRefreshToken(refreshToken: string) {
    const stored = await this.prisma.oAuthRefreshToken.findUnique({
      where: { tokenHash: sha256Hex(refreshToken) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("invalid_grant");
    }

    const accessToken = randomToken(32);
    const newRefreshToken = randomToken(48);
    const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1000);

    await this.prisma.$transaction([
      this.prisma.oAuthAccessToken.create({
        data: {
          tokenHash: sha256Hex(accessToken),
          clientId: stored.clientId,
          userId: stored.userId,
          scope: stored.scope,
          expiresAt: accessExpiresAt,
        },
      }),
      // Revoke old refresh + old access tokens from the same grant.
      this.prisma.oAuthRefreshToken.update({
        where: { tokenHash: stored.tokenHash },
        data: { revokedAt: new Date() },
      }),
      this.prisma.oAuthAccessToken.updateMany({
        where: { clientId: stored.clientId, userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.oAuthRefreshToken.create({
        data: {
          tokenHash: sha256Hex(newRefreshToken),
          clientId: stored.clientId,
          userId: stored.userId,
          scope: stored.scope,
          expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 3600 * 1000),
        },
      }),
    ]);

    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      expires_in: ACCESS_TTL_SECONDS,
      scope: stored.scope,
    };
  }

  private async issueTokens(input: {
    clientId: string;
    userId: string;
    scope: string;
  }) {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(48);

    const expiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1000);

    await this.prisma.$transaction([
      this.prisma.oAuthAccessToken.create({
        data: {
          tokenHash: sha256Hex(accessToken),
          clientId: input.clientId,
          userId: input.userId,
          scope: input.scope,
          expiresAt,
        },
      }),
      this.prisma.oAuthRefreshToken.create({
        data: {
          tokenHash: sha256Hex(refreshToken),
          clientId: input.clientId,
          userId: input.userId,
          scope: input.scope,
          expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 3600 * 1000),
        },
      }),
    ]);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: ACCESS_TTL_SECONDS,
      scope: input.scope,
    };
  }
}
