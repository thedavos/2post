import {
  Body,
  Controller,
  Get,
  HttpCode,
  Query,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { FastifyReply } from "fastify";
import { z } from "zod";

import { PrismaService } from "../../prisma/prisma.service";
import {
  emailSchema,
  loginInputSchema,
  passwordSchema,
  signupInputSchema,
} from "@brightbean/shared";
import { AuthService } from "./auth.service";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  type AccessTokenClaims,
  JWT_COOKIE,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
} from "./auth.constants";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";

const refreshSchema = z.object({}).partial().optional();

@Controller("api/app/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = loginInputSchema.parse(body);
    const result = await this.auth.login(input.email, input.password);

    this.setCookies(reply, result.accessToken, result.refreshToken);
    return { ok: true, activeOrgId: result.activeOrgId };
  }

  @Post("signup")
  @HttpCode(201)
  async signup(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = signupInputSchema.parse(body);
    const result = await this.auth.signup({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
    });

    this.setCookies(reply, result.accessToken, result.refreshToken);
    return { ok: true, activeOrgId: result.activeOrgId };
  }

  /// Google SSO — browser redirect target (legacy /accounts/google/login parity).
  @Get("google")
  async googleStart(@Res({ passthrough: true }) reply: FastifyReply) {
    if (!process.env.GOOGLE_AUTH_CLIENT_ID) {
      throw new UnauthorizedException("Google login is not configured");
    }
    const state = this.auth.signGoogleState();
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_AUTH_CLIENT_ID!,
      redirect_uri: `${process.env.APP_URL ?? ""}/social-accounts/callback/google_sso/`,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account",
    });
    reply.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      302,
    );
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  /// Google SSO callback — exchanges the code and issues app cookies.
  @Get("google/callback")
  async googleCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const failUrl = `${process.env.APP_URL ?? ""}/accounts/login?error=google`;
    if (error || !code || !state || !this.auth.verifyGoogleState(state)) {
      reply.redirect(failUrl, 302);
      return { url: failUrl };
    }

    try {
      const result = await this.auth.googleLogin(
        code,
        `${process.env.APP_URL ?? ""}/social-accounts/callback/google_sso/`,
      );
      this.setCookies(reply, result.accessToken, result.refreshToken);
      const successUrl = `${process.env.APP_URL ?? ""}/`;
      reply.redirect(successUrl, 302);
      return { url: successUrl };
    } catch {
      reply.redirect(failUrl, 302);
      return { url: failUrl };
    }
  }

  /// Always-200 forgot flow (legacy parity — no user enumeration).
  @Post("forgot-password")
  @HttpCode(200)
  forgotPassword(@Body() body: unknown) {
    const input = z.object({ email: emailSchema }).parse(body);
    void this.auth.requestPasswordReset(input.email);
    return { ok: true };
  }

  @Post("reset-password")
  @HttpCode(200)
  resetPassword(@Body() body: unknown) {
    const input = z
      .object({
        token: z.string().min(10),
        password: z.string().min(8).max(128),
      })
      .parse(body);
    return this.auth.resetPassword(input.token, input.password);
  }

  @Post("change-password")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() claims: AccessTokenClaims,
    @Body() body: unknown,
  ) {
    const input = z
      .object({ currentPassword: passwordSchema, newPassword: passwordSchema })
      .parse(body);
    void claims;
    return this.auth.changePassword(claims.sub, input.currentPassword, input.newPassword);
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Body() _body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    void refreshSchema;
    // Refresh token comes exclusively from the httpOnly cookie.
    return reply.request.cookies[REFRESH_COOKIE]
      ? this.doRefresh(reply.request.cookies[REFRESH_COOKIE] as string, reply)
      : reply.status(401).send({ message: "Session expired" });
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(reply.request.cookies[REFRESH_COOKIE]);
    reply.clearCookie(JWT_COOKIE, { path: "/" });
    reply.clearCookie(REFRESH_COOKIE, { path: "/api/app/auth" });
    return { ok: true };
  }

  @Get("session")
  @UseGuards(JwtAuthGuard)
  async session(@CurrentUser() claims: AccessTokenClaims) {
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        isSuperuser: true,
        tosAcceptedAt: true,
        orgMemberships: {
          select: {
            organizationId: true,
            orgRole: true,
            organization: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    if (!user) throw new UnauthorizedException("Not authenticated");

    return user;
  }

  private async doRefresh(token: string, reply: FastifyReply) {
    const result = await this.auth.refresh(token);
    this.setCookies(reply, result.accessToken, result.refreshToken);
    return { ok: true, activeOrgId: result.activeOrgId };
  }

  private setCookies(reply: FastifyReply, accessToken: string, refreshToken: string) {
    reply.setCookie(JWT_COOKIE, accessToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ACCESS_TOKEN_TTL_SECONDS,
    });
    reply.setCookie(REFRESH_COOKIE, refreshToken, {
      // Scoped to the auth endpoints — the browser only ever sends it there.
      path: "/api/app/auth",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: REFRESH_TTL_SECONDS,
    });
  }
}
