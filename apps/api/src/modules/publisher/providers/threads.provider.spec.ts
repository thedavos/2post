import { afterEach, describe, expect, it, vi } from "vitest";

import { OAuthError, ThreadsProvider } from "./threads.provider";

function jsonResponse(json: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => json } as unknown as Response;
}

function formBody(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(init.body as string));
}

describe("ThreadsProvider", () => {
  const provider = new ThreadsProvider().configure({
    clientId: "app-id",
    clientSecret: "app-secret",
  });

  afterEach(() => vi.unstubAllGlobals());

  it("getAuthUrl requests the legacy threads_* scope set", () => {
    const url = provider.getAuthUrl("https://app/cb/threads", "s1");
    expect(url.startsWith("https://www.threads.com/oauth/authorize?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("scope")).toBe(
      "threads_basic,threads_content_publish,threads_manage_insights,threads_manage_replies",
    );
  });

  it("exchangeCode chains short-lived → long-lived token exchange", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "short-1" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: "long-1", expires_in: 5_184_000, token_type: "bearer" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await provider.exchangeCode("code", "https://app/cb/threads");

    expect(tokens.accessToken).toBe("long-1");
    expect(tokens.expiresAt).toBeInstanceOf(Date);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(tokenUrl).toBe("https://graph.threads.net/oauth/access_token");
    const body = formBody(tokenInit);
    expect(body.grant_type).toBe("authorization_code");

    const exchangeUrl = fetchMock.mock.calls[1]![0] as string;
    expect(exchangeUrl).toContain("grant_type=th_exchange_token");
    expect(exchangeUrl).toContain("access_token=short-1");
  });

  it("exchangeCode raises OAuthError when no short-lived token comes back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }, false)));
    await expect(provider.exchangeCode("c", "cb")).rejects.toBeInstanceOf(OAuthError);
  });

  it("publishes a text thread without container polling; media threads poll first", async () => {
    const calls: Array<[string, RequestInit]> = [];
    let publishCount = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const method = init?.method ?? "GET";
      if (target.includes("/me")) return jsonResponse({ id: "u1", username: "bean" });
      if (target.includes("/threads") && method === "POST") {
        return jsonResponse({ id: `container-${calls.length}` });
      }
      if (target.includes("/threads_publish")) {
        publishCount++;
        return jsonResponse({ id: `thread-${publishCount}` });
      }
      if (target.includes("fields=status")) {
        return jsonResponse({ status: "FINISHED" });
      }
      throw new Error(`unexpected ${method} ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Text-only: /me profile lookup + create + publish, NO status polls
    await provider.publishPost("token", { caption: "text only", media: [] });
    const textCalls = (fetchMock.mock.calls as Array<[string]>).length;
    expect(textCalls).toBe(3);
    expect(
      (fetchMock.mock.calls as Array<[string]>).filter(([u]) => u.includes("fields=status"))
        .length,
    ).toBe(0);

    await provider.publishPost("token", {
      caption: "pic",
      media: [{ url: "https://cdn/a.png", type: "image" }],
      extra: { user_id: "u1" },
    });
    // image thread must have polled the container status before publishing
    const statusPolls = (fetchMock.mock.calls as Array<[string]>).filter(([u]) =>
      u.includes("fields=status"),
    ).length;
    expect(statusPolls).toBe(1);
  });

  it("waitForContainer surfaces ERROR status with the platform message", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "container-e" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "ERROR", error_message: "video codec unsupported" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    provider.sleep = async () => {};

    await expect(
      provider.publishPost("token", {
        caption: "clip",
        media: [{ url: "https://cdn/v.mp4", type: "video" }],
        extra: { user_id: "u1" },
      }),
    ).rejects.toThrow(/Threads container failed: video codec unsupported/);
  });

  it("getPostMetrics maps views/likes/replies/reposts/quotes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            { name: "views", values: [{ value: 100 }] },
            { name: "likes", values: [{ value: 10 }] },
            { name: "replies", values: [{ value: 2 }] },
            { name: "reposts", values: [{ value: 3 }] },
            { name: "quotes", values: [{ value: 1 }] },
          ],
        }),
      ),
    );

    const metrics = await provider.getPostMetrics("token", "th-1");

    expect(metrics.impressions).toBe(100);
    expect(metrics.likes).toBe(10);
    expect(metrics.comments).toBe(2);
    expect(metrics.shares).toBe(3);
    // engagements = likes + replies + reposts + quotes
    expect((metrics.meta as Record<string, number>)["engagements"]).toBe(16);
  });

  it("replies go through the container flow with reply_to_id", async () => {
    const bodies: Array<Record<string, string>> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/me")) return jsonResponse({ id: "u9" });
      if (target.includes("/threads_publish")) return jsonResponse({ id: "reply-7" });
      if (init?.method === "POST") {
        const b = formBody(init);
        bodies.push(b);
        return jsonResponse({ id: `rc-${bodies.length}` });
      }
      return jsonResponse({ status: "FINISHED" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.publishComment("token", "parent-th", "my reply");

    expect(result.platformCommentId).toBe("reply-7");
    const replyCreate = bodies.find((b) => b.reply_to_id === "parent-th");
    expect(replyCreate).toMatchObject({ media_type: "TEXT", reply_to_id: "parent-th" });
  });
});
