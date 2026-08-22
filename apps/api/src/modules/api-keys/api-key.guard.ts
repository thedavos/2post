import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { PrismaService } from "../../prisma/prisma.service";
import type { ApiKey } from "../../../generated/prisma";
import { parseToken, verifyToken } from "./api-key.crypto";
import { RateLimitService } from "./rate-limit.service";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ApiKeyRequest extends FastifyRequest {
  apiKey: ApiKey;
}

/**
 * Bearer auth for the external agent API (/api/v1/*) — contract-compatible
 * with legacy bb_studio_ keys: lookup by indexed prefix, constant-time HMAC
 * compare against the peppered hash. Also enforces the legacy fixed-window
 * rate limits (120/min key writes, 300/min key reads, 1000/min workspace)
 * and sets X-RateLimit-* / Retry-After headers.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

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

    const isWrite = WRITE_METHODS.has(request.method.toUpperCase());
    const result = await this.rateLimitService.consume(key.id, key.workspaceId, isWrite);

    // Legacy header names — external clients parse these.
    reply.header("X-RateLimit-Limit", String(result.limit));
    reply.header("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      reply.header("Retry-After", String(result.retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: 429,
          error: "Too Many Requests",
          message: `Rate limit exceeded (${result.limit}/min). Retry in ${result.retryAfterSeconds}s.`,
        },
        429,
      );
    }

    request.apiKey = key;
    return true;
  }
}
