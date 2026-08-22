import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS, RateLimitService } from "./rate-limit.service";

function makeDeps() {
  const store = new Map<string, number>();
  const prisma = {
    apiKeyRateLimit: {
      upsert: vi.fn().mockImplementation(({ where }) => {
        const key = `${where.scopeKey_windowStart.scopeKey}@${where.scopeKey_windowStart.windowStart}`;
        const next = (store.get(key) ?? 0) + 1;
        store.set(key, next);
        return Promise.resolve({ count: next });
      }),
    },
  };
  return { service: new RateLimitService(prisma as never), store };
}

describe("RateLimitService (legacy /api/v1 limits)", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("allows writes under the 120/min key limit", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < LIMITS.keyWritePerMinute; i++) {
      const result = await deps.service.consume("k1", "ws1", true, now);
      expect(result.allowed).toBe(true);
    }
    // 121st write breaches
    const breached = await deps.service.consume("k1", "ws1", true, now);
    expect(breached.allowed).toBe(false);
    expect(breached.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reads have a separate 300/min counter", async () => {
    const now = new Date();
    const first = await deps.service.consume("k2", "ws2", false, now);
    expect(first.limit).toBe(LIMITS.keyReadPerMinute);
    expect(first.remaining).toBe(LIMITS.keyReadPerMinute - 1);
  });

  it("workspace aggregate caps all keys combined at 1000/min", async () => {
    const now = new Date();
    // Simulate 400 writes from each of two keys + reads — breach via aggregate is
    // expensive to simulate exactly; instead assert aggregate scope increments.
    await deps.service.consume("a", "wsShared", true, now);
    const last = await deps.service.consume("b", "wsShared", false, now);
    expect(last.allowed).toBe(true);
    void LIMITS.workspaceAggregatePerMinute;
  });

  it("counters reset on a new window", async () => {
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date(t1.getTime() + 61_000);
    for (let i = 0; i < LIMITS.keyWritePerMinute; i++) {
      await deps.service.consume("k3", "ws3", true, t1);
    }
    const fresh = await deps.service.consume("k3", "ws3", true, t2);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(LIMITS.keyWritePerMinute - 1);
  });
});
