import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./password.crypto";
import { EmailService } from "../../common/email/email.service";

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
    private readonly email: EmailService,
  ) {}

  /**
   * Signup with auto-provisioning parity: new users get a default
   * Organization + Workspace + OWNER membership (legacy accounts post_save).
   */
  async signup(input: {
    email: string;
    password: string;
    displayName: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await hashPassword(input.password);
    const slugSuffix = Date.now().toString(36);

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        passwordHash,
        tosAcceptedAt: new Date(),
        orgMemberships: {
          create: {
            orgRole: "OWNER",
            organization: {
              create: {
                name: `${input.displayName}'s Org`,
                slug: `org-${slugSuffix}`,
                workspaces: {
                  create: { name: "Main Workspace", slug: `main-${slugSuffix}` },
                },
              },
            },
          },
        },
      },
    });

    return this.issueSession(user.id, user.email);
  }

  /**
   * Google SSO (consumer OIDC login, allauth parity): verifies the ID token
   * flow by exchanging the code, then links or creates the local user.
   */
  async googleLogin(code: string, redirectUri: string) {
    const clientId = process.env.GOOGLE_AUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new UnauthorizedException("Google login is not configured");
    }

    // Exchange authorization code for tokens.
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenResponse.json()) as Record<string, unknown>;
    const idToken = tokens["id_token"] as string | undefined;
    if (!tokenResponse.ok || !idToken) {
      throw new UnauthorizedException("Google login failed");
    }

    // Verify + decode the ID token via Google's tokeninfo endpoint
    // (signature validated server-side by Google; aud checked below).
    const infoResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    const info = (await infoResponse.json()) as Record<string, unknown>;
    if (info["aud"] !== clientId || !info["email"]) {
      throw new UnauthorizedException("Google login failed");
    }
    if (info["email_verified"] !== "true" && info["email_verified"] !== true) {
      throw new UnauthorizedException("Google account email is not verified");
    }

    const email = String(info["email"]);
    const displayName = String(info["name"] ?? email);

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Auto-provision parity: same default org/workspace as signup.
      const slugSuffix = Date.now().toString(36);
      user = await this.prisma.user.create({
        data: {
          email,
          displayName,
          passwordHash: null,
          tosAcceptedAt: new Date(),
          orgMemberships: {
            create: {
              orgRole: "OWNER",
              organization: {
                create: {
                  name: `${displayName}'s Org`,
                  slug: `org-${slugSuffix}`,
                  workspaces: {
                    create: { name: "Main Workspace", slug: `main-${slugSuffix}` },
                  },
                },
              },
            },
          },
        },
      });
    }
    if (!user.isActive) throw new UnauthorizedException("Account disabled");

    return this.issueSession(user.id, user.email);
  }

  /** Stateless signed state for the Google round-trip (no workspace yet). */
  signGoogleState(): string {
    const payload = Buffer.from(
      JSON.stringify({ purpose: "google-sso", exp: Date.now() + 10 * 60_000 }),
    ).toString("base64url");
    return `${payload}.${this.hmac(payload)}`;
  }

  verifyGoogleState(state: string): boolean {
    const dot = state.lastIndexOf(".");
    if (dot <= 0) return false;
    const body = state.slice(0, dot);
    try {
      if (
        !timingSafeEq(this.hmac(body), state.slice(dot + 1))
      ) { return false; }
      const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
        purpose?: string;
        exp?: number;
      };
      return parsed.purpose === "google-sso" && typeof parsed.exp === "number" && parsed.exp > Date.now();
    } catch {
      return false;
    }
  }

  private hmac(value: string): string {
    return createHmac("sha256", process.env.SECRET_KEY ?? "")
      .update(value)
      .digest("base64url");
  }

  /// Legacy django-ratelimit parity: 10 failed logins / 5 min per email.
  private async checkLoginRateLimit(email: string): Promise<void> {
    const windowStart = new Date(Math.floor(Date.now() / 300_000) * 300_000);
    const scopeKey = `login-fail:${email.toLowerCase()}`;
    const row = await this.prisma.apiKeyRateLimit.findUnique({
      where: { scopeKey_windowStart: { scopeKey, windowStart } },
    });
    if ((row?.count ?? 0) >= 10) {
      throw new UnauthorizedException(
        "Too many failed login attempts. Try again in a few minutes.",
      );
    }
  }

  private async recordLoginFailure(email: string): Promise<void> {
    const windowStart = new Date(Math.floor(Date.now() / 300_000) * 300_000);
    const scopeKey = `login-fail:${email.toLowerCase()}`;
    await this.prisma.apiKeyRateLimit.upsert({
      where: { scopeKey_windowStart: { scopeKey, windowStart } },
      create: { scopeKey, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
  }

  async login(email: string, password: string) {
    await this.checkLoginRateLimit(email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user?.passwordHash || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await this.recordLoginFailure(email);
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

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new UnauthorizedException("No password set");
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Current password is incorrect");

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /// Legacy parity: always-200 forgot flow; token = 32B random, SHA-256 at
  /// rest, 1-hour expiry. Email sent when SMTP configured (log otherwise).
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return;

    const raw = randomBytes(32).toString("base64url");
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    const base = process.env.APP_URL ?? "";
    await this.email.sendPasswordReset(
      email,
      `${base}/accounts/password/reset/confirm?token=${raw}`,
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException("Invalid or expired reset token");
    }

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }
}

function timingSafeEq(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i]! ^ bufB[i]!;
  return diff === 0;
}
