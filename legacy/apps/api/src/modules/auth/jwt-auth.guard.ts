import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { FastifyRequest } from "fastify";

import { JWT_COOKIE, type AccessTokenClaims } from "./auth.constants";

export interface AuthenticatedRequest extends FastifyRequest {
  user: AccessTokenClaims;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string | undefined>)?.[JWT_COOKIE];

    if (!token) {
      throw new UnauthorizedException("Not authenticated");
    }

    try {
      request.user = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch {
      throw new UnauthorizedException("Session expired");
    }

    return true;
  }
}
