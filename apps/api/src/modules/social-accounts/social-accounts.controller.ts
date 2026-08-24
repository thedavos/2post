import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { randomBytes } from "node:crypto";

import { PrismaService } from "../../prisma/prisma.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { OauthStateService } from "./oauth-state.service";
import { SocialAccountsService } from "./social-accounts.service";

/** TikTok rejects redirect URIs containing its brand name (legacy alias). */
const PLATFORM_URL_ALIASES: Record<string, string> = { tiktok: "social1" };

function toUrlSlug(platform: string): string {
  return PLATFORM_URL_ALIASES[platform] ?? platform;
}

@UseGuards(JwtAuthGuard)
@Controller("api/app/workspaces/:workspaceId/social-accounts")
export class SocialAccountsController {
  constructor(
    private readonly service: SocialAccountsService,
    private readonly state: OauthStateService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
  ) {
    await this.service.assertManagePermission(user.sub, workspaceId);
    return { results: await this.service.list(workspaceId) };
  }

  /**
   * Starts a connect flow.
   * - bluesky/devto → inline connect with the provided credentials.
   * - mastodon → registers an app on the instance, then browser flow.
   * - everything else → signed-state browser redirect to the platform.
   */
  @Post("connect/:platform")
  @HttpCode(200)
  async connect(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("workspaceId") workspaceId: string,
    @Param("platform") platform: string,
    @Body() body: unknown,
  ) {
    if (platform === "bluesky" || platform === "devto") {
      const input = z
        .object({
          handle: z.string().optional(),
          appPassword: z.string().optional(),
          apiKey: z.string().optional(),
        })
        .parse(body);
      const account = await this.service.connectWithCredentials(user.sub, workspaceId, platform, {
        handle: input.handle ?? "",
        appPassword: input.appPassword ?? "",
        apiKey: input.apiKey ?? "",
      });
      return { mode: "connected", account };
    }

    const redirectUri = this.buildRedirectUri(platform);
    let codeVerifier: string | undefined;
    if (platform === "tiktok") {
      codeVerifier = randomBytes(32).toString("base64url");
    }

    const state = await this.state.issue(
      { workspaceId, platform, userId: user.sub },
      codeVerifier,
    );

    let authUrl: string;
    if (platform === "mastodon") {
      const input = z.object({ instanceUrl: z.string().min(4) }).parse(body);
      const registration = await this.service.prepareMastodonConnect(
        user.sub,
        workspaceId,
        input.instanceUrl,
      );
      const provider = this.service.requireProvider("mastodon") as unknown as {
        configure: (i: string) => unknown;
        getAuthUrl: (r: string, s: string) => string;
      };
      provider.configure(registration.instanceUrl);
      authUrl = provider.getAuthUrl(redirectUri, state);

      // Persist the registration for the callback's token exchange.
      const row = await this.latestConnectRequest(user.sub, workspaceId, platform);
      if (row) {
        await this.prisma.oauthConnectRequest.update({
          where: { id: row.id },
          data: { pendingPages: { mastodon: registration } as never },
        });
      }
    } else {
      const provider = this.service.requireProvider(platform);
      authUrl =
        platform === "tiktok"
          ? (
              provider as unknown as {
                getAuthUrl: (r: string, s: string, v?: string) => string;
              }
            ).getAuthUrl(redirectUri, state, codeVerifier)
          : await provider.getAuthUrl(redirectUri, state);
    }

    return { mode: "redirect", authUrl };
  }

  @Delete(":accountId")
  async disconnect(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("accountId") accountId: string,
  ) {
    await this.service.disconnect(user.sub, accountId);
    return { ok: true };
  }

  buildRedirectUri(platform: string): string {
    const base = process.env.APP_URL ?? "";
    return `${base}/social-accounts/callback/${toUrlSlug(platform)}/`;
  }

  private async latestConnectRequest(userId: string, workspaceId: string, platform: string) {
    return this.prisma.oauthConnectRequest.findFirst({
      where: { userId, workspaceId, platform, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  }
}
