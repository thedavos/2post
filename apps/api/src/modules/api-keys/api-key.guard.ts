import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { PrismaService } from "../../prisma/prisma.service";
import { parseToken, verifyToken } from "./api-key.crypto";
import type { ApiKey } from "../../../generated/prisma";

export interface ApiKeyRequest extends FastifyRequest {
  apiKey: ApiKey;
}

/**
 * Bearer auth for the external agent API (/api/v1/*) — contract-compatible
 * with legacy bb_studio_ keys: lookup by indexed prefix, constant-time HMAC
 * compare against the peppered hash.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;

    const parsed = parseToken(bearer);
    if (!parsed) throw new UnauthorizedException("Invalid API key");

    const key = await this.prisma.apiKey.findUnique({
      where: { lookupPrefix: parsed.lookupPrefix },
    });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) {
      throw new UnauthorizedException("Invalid API key");
    }
    if (!verifyToken(bearer!, key.tokenHash)) {
      throw new UnauthorizedException("Invalid API key");
    }

    request.apiKey = key;
    return true;
  }
}
