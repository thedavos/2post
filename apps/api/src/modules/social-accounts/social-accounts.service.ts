import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";

import type { AccountProfile } from "@brightbean/shared";
import { CryptoService } from "../../common/crypto/crypto.service";
import { PrismaService } from "../../prisma/prisma.service";
import type { SocialAccount } from "../../../generated/prisma";
import { ProviderRegistry } from "../publisher/provider.registry";

/** Platforms that connect Pages/organizations instead of personal profiles. */
const PAGE_BASED_PLATFORMS = new Set(["facebook", "instagram", "linkedin_company"]);

/** Platforms whose credentials the user provides directly (no OAuth redirect). */
export const CREDENTIAL_PLATFORMS = new Set(["bluesky", "devto"]);

interface MastodonAppRegistration {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
}

@Injectable()
export class SocialAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly crypto: CryptoService,
  ) {}

  isPageBased(platform: string): boolean {
    return PAGE_BASED_PLATFORMS.has(platform);
  }

  requireProvider(platform: string) {
    if (!this.registry.has(platform)) {
      throw new NotFoundException(`Unknown platform "${platform}"`);
    }
    return this.registry.get(platform);
  }

  /** Creates or updates the workspace account from an OAuth profile result.
   * Tokens are encrypted at rest with the legacy-compatible AES-GCM cipher. */
  async createOrUpdateAccount(input: {
    workspaceId: string;
    platform: string;
    profile: AccountProfile;
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number | null;
    instanceUrl?: string;
  }): Promise<SocialAccount> {
    const tokenExpiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000)
      : null;

    return this.prisma.socialAccount.upsert({
      where: {
        workspaceId_platform_accountPlatformId: {
          workspaceId: input.workspaceId,
          platform: input.platform,
          accountPlatformId: input.profile.platformAccountId,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        platform: input.platform,
        accountPlatformId: input.profile.platformAccountId,
        accountName: input.profile.displayName || input.profile.username,
        accountHandle: input.profile.username ?? "",
        avatarUrl: input.profile.avatarUrl ?? "",
        followerCount: input.profile.followers ?? 0,
        oauthAccessToken: this.crypto.encrypt(input.accessToken),
        oauthRefreshToken: input.refreshToken ? this.crypto.encrypt(input.refreshToken) : null,
        tokenExpiresAt,
        instanceUrl: input.instanceUrl ?? "",
        connectionStatus: "CONNECTED",
      },
      update: {
        accountName: input.profile.displayName || input.profile.username,
        accountHandle: input.profile.username ?? "",
        avatarUrl: input.profile.avatarUrl ?? "",
        followerCount: input.profile.followers ?? 0,
        oauthAccessToken: this.crypto.encrypt(input.accessToken),
        ...(input.refreshToken ? { oauthRefreshToken: this.crypto.encrypt(input.refreshToken) } : {}),
        tokenExpiresAt,
        ...(input.instanceUrl !== undefined ? { instanceUrl: input.instanceUrl } : {}),
        connectionStatus: "CONNECTED",
      },
    });
  }

  async assertManagePermission(userId: string, workspaceId: string): Promise<void> {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { workspaceRole: true },
    });
    if (!membership) throw new ForbiddenException("No access to this workspace");

    // manage_social_accounts grants: owner/manager/editor (legacy matrix).
    const role = membership.workspaceRole.toLowerCase();
    if (!new Set(["owner", "manager", "editor"]).has(role)) {
      throw new ForbiddenException("You do not have permission to manage social accounts");
    }
  }

  async list(workspaceId: string) {
    return this.prisma.socialAccount.findMany({
      where: { workspaceId },
      select: {
        id: true,
        platform: true,
        accountName: true,
        accountHandle: true,
        avatarUrl: true,
        followerCount: true,
        connectionStatus: true,
        tokenExpiresAt: true,
        instanceUrl: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async disconnect(userId: string, accountId: string): Promise<void> {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id: accountId },
      include: { workspace: { select: { organizationId: true } } },
    });
    if (!account) throw new NotFoundException("Social account not found");

    const membership = await this.prisma.orgMembership.findUnique({
      where: {
        userId_organizationId: { userId, organizationId: account.workspace.organizationId },
      },
    });
    if (!membership) throw new ForbiddenException("No access to this account");

    // Best-effort platform-side revocation; never blocks disconnection.
    try {
      const provider = this.registry.get(account.platform) as unknown as {
        revokeToken?: (token: string) => Promise<boolean> | boolean;
      };
      if (account.oauthAccessToken && typeof provider.revokeToken === "function") {
        await provider.revokeToken(this.crypto.decrypt(account.oauthAccessToken));
      }
    } catch {
      // ignore revocation failures
    }

    await this.prisma.socialAccount.delete({ where: { id: accountId } });
  }

  /// bluesky / devto: credentials provided directly, no browser redirect.
  async connectWithCredentials(
    userId: string,
    workspaceId: string,
    platform: "bluesky" | "devto",
    credentials: Record<string, string>,
  ): Promise<SocialAccount> {
    await this.assertManagePermission(userId, workspaceId);
    const provider = this.requireProvider(platform);

    let accessToken = "";
    let refreshToken: string | undefined;
    let profile: AccountProfile;

    if (platform === "bluesky") {
      const session = await (
        provider as unknown as {
          createSession: (
            h: string,
            p: string,
          ) => Promise<{ accessToken: string; refreshToken: string }>;
        }
      ).createSession(credentials.handle ?? "", credentials.appPassword ?? "");
      accessToken = session.accessToken;
      refreshToken = session.refreshToken;
      profile = await provider.getProfile(session.accessToken);
    } else {
      accessToken = credentials.apiKey ?? "";
      if (!accessToken) throw new NotFoundException("DEV.to API key required");
      profile = await provider.getProfile(accessToken);
    }

    return this.createOrUpdateAccount({
      workspaceId,
      platform,
      profile,
      accessToken,
      refreshToken,
    });
  }

  /** Mastodon registers an app on-the-fly and stores its client credentials
   * on the connect request row so the callback can complete the exchange. */
  async prepareMastodonConnect(
    userId: string,
    workspaceId: string,
    instanceUrlRaw: string,
  ): Promise<MastodonAppRegistration> {
    await this.assertManagePermission(userId, workspaceId);
    const provider = this.requireProvider("mastodon") as unknown as {
      configure: (i: string) => unknown;
      registerApp: (i: string, r: string) => Promise<{ clientId: string; clientSecret: string }>;
    };

    const instanceUrl = normalizeInstanceUrl(instanceUrlRaw);
    provider.configure(instanceUrl);
    const app = await provider.registerApp(
      instanceUrl,
      `${process.env.APP_URL ?? ""}/social-accounts/callback/mastodon`,
    );
    return { instanceUrl, ...app };
  }

  async completeMastodonCallback(input: {
    workspaceId: string;
    code: string;
    registration: MastodonAppRegistration;
  }): Promise<SocialAccount> {
    const provider = this.requireProvider("mastodon") as unknown as {
      configure: (i: string) => unknown;
      exchangeCode: (
        c: string,
        r: string,
      ) => Promise<{ accessToken: string; tokenType?: string }>;
      getProfile: (t: string) => Promise<AccountProfile>;
    };
    provider.configure(input.registration.instanceUrl);

    const tokens = await provider.exchangeCode(
      input.code,
      `${process.env.APP_URL ?? ""}/social-accounts/callback/mastodon`,
    );
    const profile = await provider.getProfile(tokens.accessToken);

    return this.createOrUpdateAccount({
      workspaceId: input.workspaceId,
      platform: "mastodon",
      profile,
      accessToken: tokens.accessToken,
      instanceUrl: input.registration.instanceUrl,
    });
  }
}

function normalizeInstanceUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) url = `https://${url}`;
  return url;
}
