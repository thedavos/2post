import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/// Parity with legacy django-ratelimit config on the agent API.
export const LIMITS = {
  keyWritePerMinute: 120,
  keyReadPerMinute: 300,
  workspaceAggregatePerMinute: 1000,
} as const;

const WINDOW_MS = 60_000;

@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  private windowStart(now = new Date()): Date {
    return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  }

  /** Increments the counters and reports whether the request may proceed. */
  async consume(
    apiKeyId: string,
    workspaceId: string,
    isWrite: boolean,
    now = new Date(),
  ): Promise<RateLimitResult> {
    const window = this.windowStart(now);
    const kind = isWrite ? "write" : "read";
    const limit = isWrite ? LIMITS.keyWritePerMinute : LIMITS.keyReadPerMinute;

    // Per-key counter.
    const keyCount = await this.increment(`key:${apiKeyId}:${kind}`, window);
    if (keyCount > limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: Math.ceil((window.getTime() + WINDOW_MS - now.getTime()) / 1000),
      };
    }

    // Workspace aggregate (both reads and writes count together).
    const aggregate = await this.increment(`ws:${workspaceId}:aggregate`, window);
    if (aggregate > LIMITS.workspaceAggregatePerMinute) {
      return {
        allowed: false,
        limit: LIMITS.workspaceAggregatePerMinute,
        remaining: 0,
        retryAfterSeconds: Math.ceil((window.getTime() + WINDOW_MS - now.getTime()) / 1000),
      };
    }

    return { allowed: true, limit, remaining: Math.max(0, limit - keyCount), retryAfterSeconds: 0 };
  }

  private async increment(scopeKey: string, windowStart: Date): Promise<number> {
    const row = await this.prisma.apiKeyRateLimit.upsert({
      where: { scopeKey_windowStart: { scopeKey, windowStart } },
      create: { scopeKey, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    return row.count;
  }
}
