import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { FastifyReply } from "fastify";
import { z } from "zod";

import { PrismaService } from "../../prisma/prisma.service";
import { loginInputSchema, signupInputSchema } from "@brightbean/shared";
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
