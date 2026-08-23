import { afterEach, describe, expect, it, vi } from "vitest";

import { InstagramProvider } from "./instagram.provider";

function graphResponse(json: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => json } as unknown as Response;
}

describe("InstagramProvider", () => {
  const provider = new InstagramProvider().configure({
    clientId: "app-id",
    clientSecret: "app-secret",
  });

  afterEach(() => vi.unstubAllGlobals());

  it("getAuthUrl requests the legacy IG scope set via Facebook dialog", () => {
    const url = provider.getAuthUrl("https://app/cb/instagram", "s1");
    expect(url.startsWith("https://www.facebook.com/v25.0/dialog/oauth?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("scope")).toContain("instagram_content_publish");
    expect(params.get("scope")).toContain("instagram_manage_comments");
    expect(params.get("scope")).not.toContain("pages_messaging");
  });

  it("publishes a single video as REELS (legacy fix #118)", async () => {
    const fetchMock = vi.fn();
    // container create → REELS payload
    fetchMock.mockResolvedValueOnce(graphResponse({ id: "container-1" }));
    // poll status
    fetchMock.mockResolvedValueOnce(
      graphResponse({ status_code: "FINISHED" }),
    );
    // media_publish
    fetchMock.mockResolvedValueOnce(graphResponse({ id: "media-77" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.publishPost("token", {
      caption: "reel time",
      media: [{ url: "https://cdn/clip.mp4", type: "video" }],
      extra: { igUserId: "ig-1" },
    });

    expect(result.platformPostId).toBe("media-77");
    expect(result.permalink).toBe("https://www.instagram.com/p/media-77/");

    const createCall = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(createCall.media_type).toBe("REELS");
    expect(createCall.video_url).toBe("https://cdn/clip.mp4");

    const publishUrl = fetchMock.mock.calls[2]![0] as string;
    expect(publishUrl).toContain("/media_publish");
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body).creation_id).toBe("container-1");
  });

  it("carousel creates children first (is_carousel_item), then the carousel container", async () => {
    let callIndex = 0;
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        const body = JSON.parse(init!.body as string) as Record<string, unknown>;
        bodies.push(body);
        return graphResponse({ id: `c${callIndex++}` });
      }
      return graphResponse({ status_code: "FINISHED" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.publishPost("token", {
      caption: "carousel",
      media: [
        { url: "https://cdn/a.png", type: "image" },
        { url: "https://cdn/b.mp4", type: "video" },
      ],
      extra: { carousel: true, igUserId: "ig-1" },
    });

    expect(bodies.length).toBe(4); // 2 children + carousel + publish
    expect(bodies[0]).toMatchObject({ is_carousel_item: true, image_url: "https://cdn/a.png" });
    expect(bodies[1]).toMatchObject({ is_carousel_item: true, media_type: "VIDEO" });
    expect(bodies[2]).toMatchObject({ media_type: "CAROUSEL", children: "c0,c1" });
    expect(bodies[3]).toEqual({ creation_id: "c2" });
  });

  it("throws when the container reports ERROR status", async () => {
    provider.sleep = async () => {}; // fast test
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(graphResponse({ id: "container-x" }));
    fetchMock.mockResolvedValue(graphResponse({ status_code: "ERROR", status: "media invalid" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.publishPost("token", {
        caption: "bad",
        media: [{ url: "https://cdn/a.jpg", type: "image" }],
        extra: { igUserId: "ig-1" },
      }),
    ).rejects.toThrow(/Instagram container failed: media invalid/);
  });

  it("account metrics leave followers null when profile fetch fails (no poisoned zeros)", async () => {
    const fetchMock = vi.fn();
    // insights per metric — all succeed with empty data
    for (let i = 0; i < 4; i++) fetchMock.mockResolvedValueOnce(graphResponse({ data: [] }));
    // profile fields fetch fails
    fetchMock.mockResolvedValueOnce(graphResponse({ error: { message: "nope" } }, false, 400));
    vi.stubGlobal("fetch", fetchMock);

    const metrics = await provider.getAccountMetrics(
      "token",
      new Date("2026-01-01"),
      new Date("2026-01-31"),
      { igUserId: "ig-1" },
    );

    expect(metrics.followers).toBeNull();
    expect(metrics.reach).toBe(0);

    // metric_type=total_value params on total-value metrics (legacy parity)
    const insightUrls = (fetchMock.mock.calls as Array<[string]>)
      .map(([u]) => u)
      .filter((u) => u.includes("/insights"));
    expect(insightUrls.some((u) => u.includes("metric_type=total_value"))).toBe(true);
  });
});
