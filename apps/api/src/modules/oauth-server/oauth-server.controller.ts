import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { PrismaService } from "../../prisma/prisma.service";
import { OAuthServerService } from "./oauth-server.service";

/**
 * OAuth 2.1 authorization server for MCP clients (Claude Desktop et al).
 * Public clients + PKCE S256; paths are FROZEN external contracts.
 */

const dcrSchema = z.object({
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(z.string()).min(1).refine(
    (uris) =>
      uris.every((u) => /^https?:\/\//.test(u) || u.startsWith(`${process.env.APP_URL}/`)),
    { message: "redirect_uris must be absolute http(s) URLs" },
  ),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).default(["code"]),
  token_endpoint_auth_method: z.string().optional(),
});

@Controller()
export class OAuthServerController {
  constructor(
    private readonly oauth: OAuthServerService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // ------------------------------------------------------------------ DCR

  /// Dynamic Client Registration (RFC 7591) — open, public clients only.
  @Post("oauth/register")
  @HttpCode(201)
  async register(@Body() body: unknown) {
    const input = dcrSchema.parse(body);
    const clientId = `mcp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    const app = await this.prisma.oAuthApplication.create({
      data: {
        clientId,
        name: input.client_name,
        redirectUris: input.redirect_uris as never,
        grantTypes: input.grant_types,
        isConfidential: false,
      },
      select: { clientId: true, name: true },
    });

    return {
      client_id: app.clientId,
      client_name: app.name,
      redirect_uris: input.redirect_uris,
      grant_types: input.grant_types,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  // ------------------------------------------------------------- authorize

  /// Browser flow. Requires the user's JWT cookie (web login sets it on this
  /// domain); unauthenticated browsers are sent to login with a return URL.
  @Get("oauth/authorize")
  async authorize(
    @Query("client_id") clientId: string | undefined,
    @Query("redirect_uri") redirectUri: string | undefined,
    @Query("state") state: string | undefined,
    @Query("scope") scope: string | undefined,
    @Query("response_type") responseType: string | undefined,
    @Query("code_challenge") codeChallenge: string | undefined,
    @Query("code_challenge_method") codeChallengeMethod: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!clientId || !redirectUri || responseType !== "code") {
      throw new BadRequestException(
        "client_id, redirect_uri and response_type=code required",
      );
    }

    const app = await this.oauth.requireApplication(clientId);
    if (!this.oauth.validateRedirectUri(app, redirectUri)) {
      throw new ForbiddenException("redirect_uri not registered");
    }

    const cookies = (request.cookies ?? {}) as Record<string, string>;
    const accessToken = cookies["bb_at"];
    let userId: string | null = null;

    if (accessToken) {
      try {
        const claims = await this.jwt.verifyAsync<{ sub: string }>(accessToken);
        const user = await this.prisma.user.findUnique({
          where: { id: claims.sub },
          select: { id: true, isActive: true },
        });
        if (user?.isActive) userId = user.id;
      } catch {
        userId = null;
      }
    }

    if (!userId) {
      const returnTo =
        `/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${encodeURIComponent(state ?? "")}` +
        `&scope=${encodeURIComponent(scope ?? "")}` +
        `&response_type=code` +
        `&code_challenge=${encodeURIComponent(codeChallenge ?? "")}` +
        `&code_challenge_method=${encodeURIComponent(codeChallengeMethod ?? "S256")}`;
      const loginUrl = `${process.env.APP_URL ?? ""}/accounts/login?redirect=${encodeURIComponent(returnTo)}`;
      reply.redirect(loginUrl, 302);
      return { url: loginUrl };
    }

    const code = await this.oauth.issueAuthCode({
      clientId,
      userId,
      redirectUri,
      scope: scope ?? "",
      codeChallenge: codeChallenge ?? null,
      codeChallengeMethod: codeChallengeMethod ?? null,
    });

    const separator = redirectUri.includes("?") ? "&" : "?";
    const location = `${redirectUri}${separator}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state ?? "")}`;
    reply.redirect(location, 302);
    return { url: location };
  }

  // ----------------------------------------------------------------- token

  @Post("oauth/token")
  token(@Body() body: Record<string, string>) {
    const grantType = body["grant_type"];

    if (grantType === "authorization_code") {
      return this.oauth.exchangeAuthCode({
        code: String(body["code"] ?? ""),
        clientId: String(body["client_id"] ?? ""),
        redirectUri: String(body["redirect_uri"] ?? ""),
        codeVerifier: body["code_verifier"],
      });
    }

    if (grantType === "refresh_token") {
      return this.oauth.rotateRefreshToken(String(body["refresh_token"] ?? ""));
    }

    throw new UnauthorizedException(`unsupported grant_type: ${grantType}`);
  }
}
