import { afterEach, describe, expect, it, vi } from "vitest";

import { InstagramLoginProvider } from "./instagram-login.provider";

function jsonResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response;
}

describe("InstagramLoginProvider", () => {
  const provider = new InstagramLoginProvider().configure({
    clientId: "ig-app-id",
    clientSecret: "ig-secret",
  });

  afterEach(() => vi.unstubAllGlobals());

  it("getAuthUrl uses instagram.com with enable_fb_login=0 (legacy parity)", () => {
    const url = new URL(provider.getAuthUrl("cb", "s1"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("enable_fb_login")).toBe("0");
    expect(url.searchParams.get("force_authentication")).toBe("1");
    expect(url.searchParams.get("scope")).toContain("instagram_business_content_publish");
    expect(url.searchParams.get("client_id")).toBe("ig-app-id");
  });

  it("exchangeCode posts multipart/form-data then chains long-lived exchange", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "short-1", user_id: "42" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: "long-1", expires_in: 5_184_000, token_type: "bearer" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await provider.exchangeCode("code", "cb");

    // The access token IS the refresh token on this path.
    expect(tokens.refreshToken).toBe("long-1");
    expect(tokens.expiresAt).toBeInstanceOf(Date);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.instagram.com/oauth/access_token");
    expect(tokenInit.body).toBeInstanceOf(FormData); // multipart, not urlencoded

    const exchangeUrl = fetchMock.mock.calls[1]![0] as string;
    expect(exchangeUrl).toContain("grant_type=ig_exchange_token");
  });

  it("publishes single video as REELS via /me/media containers", async () => {
    const calls: Array<[string, RequestInit?]> = [];
    let containerCount = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      calls.push([target, init]);
      if (target.includes("/me/media_publish")) return jsonResponse({ id: "media-5" });
      if (target.includes("/me/media") && init?.method === "POST") {
        containerCount++;
        return jsonResponse({ id: `c${containerCount}` });
      }
      if (target.includes("fields=status_code")) return jsonResponse({ status_code: "FINISHED" });
      throw new Error(`unexpected ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.publishPost("token", {
      caption: "reel",
      media: [{ url: "https://cdn/v.mp4", type: "video" }],
    });

    expect(result.platformPostId).toBe("media-5");
    const createBody = JSON.parse(calls[0]![1]!.body as string);
    expect(createBody.media_type).toBe("REELS");
    const publishUrl = calls[calls.length - 1]![0];
    expect(publishUrl).toContain("/me/media_publish");
  });

  it("refreshToken uses ig_refresh_token with the access token itself", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "new-tok", expires_in: 5_184_000 }));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await provider.refreshToken("old-tok");
    expect(tokens.accessToken).toBe("new-tok");
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("grant_type=ig_refresh_token");
  });
});
