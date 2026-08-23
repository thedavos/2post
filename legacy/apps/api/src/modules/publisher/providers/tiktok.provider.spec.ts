import { afterEach, describe, expect, it, vi } from "vitest";

import { TikTokProvider, pkceCodeChallenge } from "./tiktok.provider";

function jsonResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response;
}

describe("pkceCodeChallenge", () => {
  it("is base64url(SHA256(verifier)) without padding", () => {
    const challenge = pkceCodeChallenge("test-verifier");
    expect(challenge).not.toContain("=");
    expect(challenge).not.toMatch(/[+/]/);
    // deterministic
    expect(pkceCodeChallenge("test-verifier")).toBe(challenge);
  });
});

describe("TikTokProvider", () => {
  const provider = new TikTokProvider().configure({
    clientKey: "ck",
    clientSecret: "cs",
  });

  afterEach(() => vi.unstubAllGlobals());

  it("getAuthUrl uses client_key and adds S256 PKCE when a verifier is given", () => {
    const url = new URL(provider.getAuthUrl("cb", "s1"));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("ck");
    expect(url.searchParams.has("code_challenge")).toBe(false);

    const withPkce = new URL(provider.getAuthUrl("cb", "s1", "verifier-1"));
    expect(withPkce.searchParams.get("code_challenge_method")).toBe("S256");
    expect(withPkce.searchParams.get("code_challenge")).toBe(
      pkceCodeChallenge("verifier-1"),
    );
  });

  it("rejects non-video posts immediately (legacy PublishError)", async () => {
    await expect(
      provider.publishPost("t", {
        caption: "not a video",
        media: [{ url: "https://cdn/a.png", type: "image" }],
      }),
    ).rejects.toThrow(/only supports VIDEO posts/);
  });

  it("validates privacy_level before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.publishPost("t", {
        caption: "x",
        media: [{ url: "https://cdn/v.mp4", type: "video" }],
        extra: { privacy_level: "EVERYONE" },
      }),
    ).rejects.toThrow(/Invalid privacy_level/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publishes via PULL_FROM_URL storing the publish_id handle", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { publish_id: "v_pub_url~abc123" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.publishPost("t", {
      caption: "my video",
      title: "My Video",
      media: [{ url: "https://media.example.com/v.mp4", type: "video" }],
      extra: { disable_comment: true, video_cover_timestamp_ms: "1500" },
    });

    // publish_id is a HANDLE — the numeric video id only exists after PUBLISH_COMPLETE
    expect(result.platformPostId).toBe("v_pub_url~abc123");

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/post/publish/video/init/");
    const body = JSON.parse(init.body as string);
    expect(body.source_info).toEqual({
      source: "PULL_FROM_URL",
      video_url: "https://media.example.com/v.mp4",
    });
    expect(body.post_info.title).toBe("My Video");
    expect(body.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(body.post_info.disable_comment).toBe(true);
    expect(body.post_info.video_cover_timestamp_ms).toBe(1500); // coerced to int
  });

  it("resolveVideoId passes numeric ids through and polls handles to completion", async () => {
    // numeric passthrough needs no network
    await expect(provider.resolveVideoId("t", "7301234567890123456")).resolves.toBe(
      "7301234567890123456",
    );

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          status: "PUBLISH_COMPLETE",
          publicaly_available_post_id: ["7399876543210987654"], // typo is API contract
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider.resolveVideoId("t", "v_pub_url~abc")).resolves.toBe(
      "7399876543210987654",
    );
    void jsonResponse;
  });
});
