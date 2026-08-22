import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { createHash } from "node:crypto";

import { PrismaService } from "../../prisma/prisma.service";
import type { ApiKey } from "../../../generated/prisma";
import { parseToken, verifyToken } from "./api-key.crypto";
import { RateLimitService } from "./rate-limit.service";

export interface AuthContext {
  kind: "api-key" | "oauth";
  workspaceId: string;
  permissions: string[];
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ApiKeyRequest extends FastifyRequest {
  apiKey: ApiKey;
  oauthUserId?: string;
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
    if (!bearer) {
      reply.header(
        "WWW-Authenticate",
        `Bearer resource_metadata="${process.env.APP_URL ?? ""}/.well-known/oauth-protected-resource/api/v1/mcp"`,
      );
      throw new UnauthorizedException("Missing bearer token");
    }

    // MCP OAuth bearer (opaque token, SHA-256 stored).
    if (!bearer.startsWith("bb_studio_")) {
      const token = await this.prisma.oAuthAccessToken.findUnique({
        where: { tokenHash: createHash("sha256").update(bearer).digest("hex") },
        include: { user: true },
      });
      if (!token || token.revokedAt || token.expiresAt < new Date() || !token.user.isActive) {
        throw new UnauthorizedException("Invalid token");
      }
      const membership = await this.prisma.orgMembership.findFirst({
        where: { userId: token.userId, organization: { deletionScheduledAt: null } },
        orderBy: { createdAt: "asc" },
        select: { organizationId: true },
      });
      const workspace = membership
        ? await this.prisma.workspace.findFirst({
            where: { organizationId: membership.organizationId },
            select: { id: true },
          })
        : null;
      request.oauthUserId = token.userId;
      // Workspace context for tools; per-workspace permission mapping lands
      // with the MCP tool expansion phase.
      (request as unknown as Record<string, unknown>)["apiKey"] = {
        id: `oauth:${token.id}`,
        name: "MCP OAuth",
        workspaceId: workspace?.id ?? "",
        permissions: ["create_posts", "publish_directly", "upload_media", "view_analytics"],
      };
      return true;
    }

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
