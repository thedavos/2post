import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";

import { MembershipService } from "../../common/tenancy/membership.service";
import { PrismaService } from "../../prisma/prisma.service";

import { OauthStateService } from "./oauth-state.service";
import { SocialAccountsService } from "./social-accounts.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
const PLATFORM_URL_ALIASES: Record<string, string> = { tiktok: "social1" };
const URL_ALIAS_TO_PLATFORM: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_URL_ALIASES).map(([k, v]) => [v, k]),
);

/**
 * Public OAuth callback — path is byte-identical to the legacy route
 * `/social-accounts/callback/{platform}/` because these URLs are registered
 * at each platform's developer console. Handles the exchange server-side and
 * redirects back to the web app.
 */
@Controller("social-accounts")
export class OauthCallbackController {
  constructor(
    private readonly service: SocialAccountsService,
    private readonly state: OauthStateService,
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  @Get("callback/:platform/")
  async callback(
    @Param("platform") platformSlug: string,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const platform = URL_ALIAS_TO_PLATFORM[platformSlug] ?? platformSlug;

    if (error) {
      return this.redirectBack(reply, null, `OAuth error: ${errorDescription ?? error}`);
    }
    if (!code || !state) {
      return this.redirectBack(reply, null, "Missing authorization code or state parameter.");
    }

    const payload = await this.state.consume(state);
    if (!payload) {
      return this.redirectBack(reply, null, "Invalid or expired OAuth state. Please try again.");
    }
    if (payload.platform !== platform) {
      return this.redirectBack(reply, null, "Platform mismatch in OAuth callback.");
    }

    // Re-check permissions — the user may have lost access during the OAuth round-trip.
    try {
      await this.service.assertManagePermission(payload.userId, payload.workspaceId);
      await this.membership.requireOrgRole(payload.userId, await this.orgIdOf(payload.workspaceId));
    } catch {
      throw new ForbiddenException("You no longer have access to this workspace.");
    }

    const requestRow = await this.latestConnectRequest(payload);

    try {
      const provider = this.service.requireProvider(platform);

      const verifier =
        platform === "tiktok" ? (requestRow?.codeVerifier ?? undefined) : undefined;
      const tokens =
        platform === "tiktok"
          ? await (provider as unknown as {
              exchangeCode: (c: string, r: string, v?: string) => Promise<import("@brightbean/shared").OAuthTokens>;
            }).exchangeCode(code, this.redirectUri(platform), verifier)
          : await provider.exchangeCode(code, this.redirectUri(platform));

      // Facebook / Instagram / LinkedIn Company connect Pages, not personal profiles.
      if (this.service.isPageBased(platform)) {
        const pagesProvider = provider as unknown as {
          getUserPages?: (t: string) => Promise<Array<Record<string, unknown>>>;
        };
        const pages = (await pagesProvider.getUserPages?.(tokens.accessToken)) ?? [];

        if (pages.length > 0 && requestRow) {
          await this.prisma.oauthConnectRequest.update({
            where: { id: requestRow.id },
            data: {
              pendingPages: ({
                selection: {
                  workspaceId: payload.workspaceId,
                  platform,
                  accessToken: tokens.accessToken,
                  refreshToken: tokens.refreshToken ?? null,
                  pages,
                },
              }) as never,
              expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            },
          });
          return this.redirectTo(reply, `/${payload.workspaceId}/social-accounts/select`);
        }
        return this.redirectTo(
          reply,
          `/${payload.workspaceId}/social-accounts?warning=no_pages`,
        );
      }

      // Mastodon completes with its per-instance registration.
      if (platform === "mastodon") {
        const registration = (
          (requestRow?.pendingPages as Record<string, unknown> | null)?.["mastodon"] as
            | { instanceUrl: string; clientId: string; clientSecret: string }
            | undefined
        );
        if (!registration) throw new NotFoundException("Mastodon registration expired");
        await this.service.completeMastodonCallback({
          workspaceId: payload.workspaceId,
          code,
          registration,
        });
      } else {
        const profile = await provider.getProfile(tokens.accessToken);
        await this.service.createOrUpdateAccount({
          workspaceId: payload.workspaceId,
          platform,
          profile,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresAt
            ? Math.max(0, Math.round((tokens.expiresAt.getTime() - Date.now()) / 1000))
            : null,
        });
      }

      return this.redirectTo(reply, `/${payload.workspaceId}/calendar?connected=1`);
    } catch (exc) {
      void exc;
      return this.redirectBack(reply, payload.workspaceId, "Failed to connect account. Please try again.");
    }
  }

  /**
   * Completes a multi-page selection (Facebook/Instagram/LinkedIn Company).
   * Consumes the pending selection stored on the connect request row.
   */
  @Post("select-account")
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async selectAccount(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        requestId: z.string().uuid(),
        pageIds: z.array(z.string()).min(1),
      })
      .parse(body);

    const row = await this.prisma.oauthConnectRequest.findUnique({
      where: { id: input.requestId },
    });
    if (!row || row.expiresAt < new Date()) throw new NotFoundException("Selection expired");

    const selectionContainer = (row.pendingPages as Record<string, unknown> | null)?.[
      "selection"
    ] as
      | {
          workspaceId: string;
          platform: string;
          accessToken: string;
          refreshToken: string | null;
          pages: Array<Record<string, unknown>>;
        }
      | undefined;
    if (!selectionContainer) throw new NotFoundException("No pending account selection");

    await this.service.assertManagePermission(user.sub, selectionContainer.workspaceId);

    const provider = this.service.requireProvider(selectionContainer.platform);
    const selected = selectionContainer.pages.filter((p) =>
      input.pageIds.includes(String(p["id"])),
    );
    if (selected.length === 0) throw new NotFoundException("No matching pages selected");

    const connected: string[] = [];
    for (const page of selected) {
      const pageToken = String(page["accessToken"] ?? selectionContainer.accessToken);
      let profile;
      try {
        profile = await provider.getProfile(pageToken);
      } catch {
        profile = {
          platformAccountId: String(page["id"]),
          username: String(page["handle"] ?? ""),
          displayName: String(page["name"] ?? ""),
          avatarUrl: (page["picture"] as string | undefined) ?? null,
          followers: Number(page["followers_count"] ?? 0),
        };
      }
      // Page-based accounts publish with the PAGE token, not the user token.
      await this.service.createOrUpdateAccount({
        workspaceId: selectionContainer.workspaceId,
        platform: selectionContainer.platform,
        profile,
        accessToken: pageToken,
        refreshToken: selectionContainer.refreshToken,
      });
      connected.push(String(page["id"]));
    }

    await this.prisma.oauthConnectRequest.delete({ where: { id: row.id } });
    void provider;
    return { ok: true, connected };
  }

  private redirectUri(platform: string): string {
    const base = process.env.APP_URL ?? "";
    const slug = platform === "tiktok" ? "social1" : platform;
    return `${base}/social-accounts/callback/${slug}/`;
  }

  private redirectTo(reply: FastifyReply, appPath: string) {
    reply.redirect(`${process.env.APP_URL ?? ""}${appPath}`, 302);
    return { url: `${process.env.APP_URL ?? ""}${appPath}` };
  }

  private redirectBack(
    reply: FastifyReply,
    workspaceId: string | null,
    message: string,
  ) {
    const base = process.env.APP_URL ?? "";
    const path = workspaceId
      ? `/${workspaceId}/social-accounts?error=${encodeURIComponent(message)}`
      : `/?error=${encodeURIComponent(message)}`;
    reply.redirect(`${base}${path}`, 302);
    return { url: `${base}${path}` };
  }

  private async orgIdOf(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new ForbiddenException("You no longer have access to this workspace.");
    return workspace.organizationId;
  }

  private async latestConnectRequest(payload: {
    userId: string;
    workspaceId: string;
    platform: string;
  }) {
    return this.prisma.oauthConnectRequest.findFirst({
      where: {
        userId: payload.userId,
        workspaceId: payload.workspaceId,
        platform: payload.platform,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

}
