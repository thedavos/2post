import { afterEach, describe, expect, it, vi } from "vitest";

import { PinterestProvider } from "./pinterest.provider";

function jsonResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response;
}

describe("PinterestProvider", () => {
  const provider = new PinterestProvider().configure({
    clientId: "pid",
    clientSecret: "psecret",
  });

  afterEach(() => vi.unstubAllGlobals());

  it("exchangeCode uses HTTP Basic auth on the token endpoint (legacy parity)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await provider.exchangeCode("code", "cb");

    expect(tokens.accessToken).toBe("at");
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const expectedBasic = Buffer.from("pid:psecret").toString("base64");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${expectedBasic}`);
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
  });

  it("refresh keeps the previous refresh token when none is returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ access_token: "at2", expires_in: 3600 })),
    );
    const tokens = await provider.refreshToken("old-rt");
    expect(tokens.refreshToken).toBe("old-rt");
  });

  it("requires board_id before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.publishPost("t", {
        caption: "pin",
        media: [{ url: "https://cdn/img.png", type: "image" }],
      }),
    ).rejects.toThrow(/board_id is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("image pins post to /pins with image_url media source", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "pin-9" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.publishPost("t", {
      caption: "my pin",
      title: "Pin Title",
      media: [{ url: "https://cdn/img.png", type: "image" }],
      extra: { board_id: "board-1", linkUrl: "https://blog/post", alt_text: "alt text" },
    });

    expect(result.platformPostId).toBe("pin-9");
    expect(result.permalink).toBe("https://www.pinterest.com/pin/pin-9/");

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/pins");
    const body = JSON.parse(init.body as string);
    expect(body.board_id).toBe("board-1");
    expect(body.title).toBe("Pin Title");
    expect(body.link).toBe("https://blog/post");
    expect(body.media_source).toEqual({ source_type: "image_url", url: "https://cdn/img.png" });
    expect(body.alt_text).toBe("alt text");
  });
});
