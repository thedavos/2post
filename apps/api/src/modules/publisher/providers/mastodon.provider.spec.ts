import { afterEach, describe, expect, it, vi } from "vitest";

import { MastodonProvider } from "./mastodon.provider";

describe("MastodonProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  function formBody(init: RequestInit): URLSearchParams {
    return new URLSearchParams(init.body as string);
  }

  function jsonResponse(json: unknown, ok = true): Response {
    return {
      ok,
      status: ok ? 200 : 400,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => json,
    } as unknown as Response;
  }

  function binaryResponse(contentType = "image/png"): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": contentType }),
      arrayBuffer: async () => new ArrayBuffer(4),
      // /api/v2/media responds with the blob JSON after upload
      json: async () => ({ id: "media-1" }),
    } as unknown as Response;
  }

  it("registerApp posts to /api/v1/apps with Brightbean defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ client_id: "cid", client_secret: "secret" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MastodonProvider();
    const result = await provider.registerApp("https://mastodon.social/", "https://app/cb");

    expect(result).toEqual({
      clientId: "cid",
      clientSecret: "secret",
      instanceUrl: "https://mastodon.social/", // returned as-passed (legacy parity)
    });
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://mastodon.social/api/v1/apps");
    const form = formBody(init);
    expect(form.get("scopes")).toBe("read write follow");
    expect(form.get("client_name")).toBe("Brightbean");
  });

  it("getAuthUrl builds instance-specific authorize URL", () => {
    const provider = new MastodonProvider().configure("https://mastodon.social", {
      clientId: "cid",
      clientSecret: "sec",
    });

    const url = provider.getAuthUrl("https://app/cb", "state-1");

    expect(url.startsWith("https://mastodon.social/oauth/authorize?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("state")).toBe("state-1");
  });

  it("exchangeCode raises OAuthError on error payloads (legacy parity)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: "invalid_grant", error_description: "bad code" }),
      ),
    );

    const provider = new MastodonProvider().configure("https://mastodon.social", {
      clientId: "cid",
      clientSecret: "sec",
    });
    await expect(provider.exchangeCode("code", "cb")).rejects.toThrow(/Token exchange failed/);
  });

  it("publishPost uploads media first then creates the status with visibility", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      calls.push([target, init ?? {}]);
      if (target.includes("/api/v2/media")) return binaryResponse();
      if (target.startsWith("https://cdn/")) return binaryResponse();
      if (target.includes("/api/v1/statuses")) {
        return jsonResponse({ id: "status-9", url: "https://mastodon.social/@bean/9" });
      }
      throw new Error(`unexpected call ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MastodonProvider().configure("https://mastodon.social");
    const result = await provider.publishPost("token-1", {
      caption: "hello fediverse",
      media: [{ url: "https://cdn/img.png", type: "image" }],
      extra: { visibility: "unlisted" },
    });

    expect(result.platformPostId).toBe("status-9");

    const mediaCallIndex = calls.findIndex(([u]) => u.includes("/api/v2/media"));
    const statusCallIndex = calls.findIndex(([u]) => u.includes("/api/v1/statuses"));
    // Media upload happens BEFORE status creation (legacy parity).
    expect(mediaCallIndex).toBeGreaterThanOrEqual(0);
    expect(statusCallIndex).toBeGreaterThan(mediaCallIndex);

    const body = formBody(calls[statusCallIndex]![1]);
    expect(body.get("status")).toBe("hello fediverse");
    expect(body.getAll("media_ids[]")).toEqual(["media-1"]);
    expect(body.get("visibility")).toBe("unlisted");
    // Bearer auth on the status create
    expect((calls[statusCallIndex]![1].headers as Record<string, string>).authorization).toBe(
      "Bearer token-1",
    );
  });

  it("refreshToken returns the token untouched (tokens do not expire)", async () => {
    const provider = new MastodonProvider();
    await expect(provider.refreshToken("tok")).resolves.toEqual({ accessToken: "tok" });
  });
});
