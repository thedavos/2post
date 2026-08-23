import { afterEach, describe, expect, it, vi } from "vitest";

import { BlueskyProvider, accessJwtExpiresIn } from "./bluesky.provider";

function jwtWithExp(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("accessJwtExpiresIn", () => {
  it("decodes the exp claim without verifying signature", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(accessJwtExpiresIn(jwtWithExp(exp))).toBeGreaterThan(3500);
  });

  it("returns null for malformed tokens", () => {
    expect(accessJwtExpiresIn("not-a-jwt")).toBeNull();
    expect(accessJwtExpiresIn("a.b.c")).toBeNull();
  });
});

describe("BlueskyProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createSession maps accessJwt/refreshJwt and derives expiry", async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accessJwt: jwtWithExp(exp),
          refreshJwt: "refresh-1",
          did: "did:plc:abc",
          handle: "bean.bsky.social",
        }),
      }),
    );

    const provider = new BlueskyProvider();
    const tokens = await provider.createSession("bean.bsky.social", "app-password");

    expect(tokens.accessToken).toContain("header.");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe("https://bsky.social/xrpc/com.atproto.server.createSession");
  });

  it("publishPost creates a record with UTF-8 byte-offset facets", async () => {
    const fetchMock = vi.fn();
    // call order: getSession, createRecord
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ did: "did:plc:abc", handle: "bean.bsky.social" }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ uri: "at://did:plc:abc/app.bsky.feed.post/3kz", cid: "c1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new BlueskyProvider();
    const result = await provider.publishPost("token-1", {
      caption: "hola ñ #bean https://ejemplo.com/x",
      media: [],
    });

    expect(result.platformPostId).toBe("at://did:plc:abc/app.bsky.feed.post/3kz");
    expect(result.permalink).toBe("https://bsky.app/profile/bean.bsky.social/post/3kz");

    const record = JSON.parse(fetchMock.mock.calls[1]![1].body).record;
    expect(record.text).toBe("hola ñ #bean https://ejemplo.com/x");
    expect(record.createdAt).toMatch(/Z$/);

    const facets = record.facets as Array<{ index: { byteStart: number; byteEnd: number }; features: Array<Record<string, unknown>> }>;
    const linkFacet = facets.find((f) =>
      f.features.some((feat) => feat["$type"] === "app.bsky.richtext.facet#link"),
    );
    const tagFacet = facets.find((f) =>
      f.features.some((feat) => feat["$type"] === "app.bsky.richtext.facet#tag"),
    );
    // "ñ" is 2 bytes in UTF-8 → offsets shift by +1 vs JS string indices.
    expect(tagFacet!.index.byteStart).toBe(8); // after "hola ñ " (7 chars → 8 bytes)
    expect(linkFacet!.index.byteStart).toBe(14); // 8 bytes prefix + "#bean" (5) + space
    expect(linkFacet!.index.byteEnd).toBe(35);
  });

  it("rejects captions over 300 graphemes", async () => {
    const provider = new BlueskyProvider();
    await expect(
      provider.publishPost("t", { caption: "a".repeat(301), media: [] }),
    ).rejects.toThrow(/300 graphemes/);
  });

  it("skips unresolvable mentions instead of failing the post", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ did: "did:plc:abc", handle: "bean" }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400, // resolveHandle failure for @missing.handle
      json: async () => ({}),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ uri: "at://x/app.bsky.feed.post/r1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new BlueskyProvider();
    const result = await provider.publishPost("t", {
      caption: "hey @missing.handle",
      media: [],
    });

    expect(result.platformPostId).toBe('at://x/app.bsky.feed.post/r1');
    const record = JSON.parse(fetchMock.mock.calls[2]![1].body).record;
    expect(record.facets).toBeUndefined();
  });
});
