import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FacebookProvider,
  pageScopedPostId,
  storedPostId,
} from "./facebook.provider";
import { MetaApiError, isMetaPermissionError } from "./meta-graph.client";

function graphResponse(json: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => json,
  } as unknown as Response;
}

describe("id helpers (legacy parity)", () => {
  it("storedPostId keeps only the post object id from PAGEID_POSTID", () => {
    expect(storedPostId("12345_67890")).toBe("67890");
    expect(storedPostId("67890")).toBe("67890");
  });

  it("pageScopedPostId prefixes bare ids with the page id", () => {
    expect(pageScopedPostId("67890", "12345")).toBe("12345_67890");
    expect(pageScopedPostId("12345_67890", "12345")).toBe("12345_67890");
    expect(pageScopedPostId("67890")).toBe("67890");
  });
});

describe("isMetaPermissionError", () => {
  it("detects permission codes and markers", () => {
    expect(
      isMetaPermissionError(
        new MetaApiError("(#10) Not authorized", undefined, {
          error: { code: 10, message: "Not authorized" },
        }),
      ),
    ).toBe(true);
    expect(
      isMetaPermissionError(new MetaApiError("bad request", 400, {})),
    ).toBe(false);
    expect(
      isMetaPermissionError(
        new MetaApiError("session expired", undefined, {
          error: { code: 190, message: "access token expired" },
        }),
      ),
    ).toBe(true);
  });
});

describe("FacebookProvider auth", () => {
  const provider = new FacebookProvider().configure({
    clientId: "app-id",
    clientSecret: "app-secret",
  });

  afterEach(() => vi.unstubAllGlobals());

  it("getAuthUrl requests the legacy scope set", () => {
    const url = provider.getAuthUrl("https://app/cb/facebook", "state-1");
    expect(url.startsWith("https://www.facebook.com/v25.0/dialog/oauth?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("client_id")).toBe("app-id");
    expect(params.get("scope")).toContain("pages_manage_posts");
    expect(params.get("scope")).toContain("read_insights");
  });

  it("exchangeCode posts to the token URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      graphResponse({ access_token: "tok-1", expires_in: 5183944, token_type: "bearer" }, true),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await provider.exchangeCode("code-1", "https://app/cb/facebook");
    expect(tokens.accessToken).toBe("tok-1");
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("code")).toBe("code-1");
    expect(body.get("client_secret")).toBe("app-secret");
  });
});

describe("FacebookProvider publishing", () => {
  afterEach(() => vi.unstubAllGlobals());

  function makeProvider() {
    return new FacebookProvider().configure({
      clientId: "id",
      clientSecret: "sec",
    });
  }

  it("text publish strips PAGEID_POSTID for storage but links to the graph id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(graphResponse({ id: "999_777" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeProvider().publishPost("token", {
      caption: "hello",
      media: [],
      extra: { pageId: "999" },
    });

    expect(result.platformPostId).toBe("777"); // stored id without prefix
    expect(result.permalink).toBe("https://www.facebook.com/999_777");
    const [url] = fetchMock.mock.calls[0]! as unknown as [string];
    expect(url).toContain("/999/feed");
  });

  it("single photo publishes to /photos using the media URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(graphResponse({ id: "photo-1", post_id: "999_888" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeProvider().publishPost("token", {
      caption: "pic",
      media: [{ url: "https://cdn/a.jpg", type: "image" }],
      extra: { pageId: "999" },
    });

    expect(result.platformPostId).toBe("888");
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/999/photos");
    expect(JSON.parse(init.body as string).url).toBe("https://cdn/a.jpg");
  });

  it("multi-photo stages unpublished photos then attaches them; cleans up on failure", async () => {
    // stage ok, stage ok, feed fails → DELETE cleanup ×2
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(graphResponse({ id: "p1" }));
    fetchMock.mockResolvedValueOnce(graphResponse({ id: "p2" }));
    fetchMock.mockResolvedValueOnce(graphResponse({ error: { message: "boom" } }, false, 500));
    fetchMock.mockResolvedValue(graphResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeProvider().publishPost("token", {
        caption: "multi",
        media: [
          { url: "https://cdn/1.png", type: "image" },
          { url: "https://cdn/2.png", type: "image" },
        ],
        extra: { pageId: "999" },
      }),
    ).rejects.toThrow();

    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    const deletes = calls.filter(([, i]) => i?.method === "DELETE");
    expect(deletes.length).toBe(2); // both staged photos cleaned up
  });

  it("rejects multi-photo sets above the attached_media cap before any call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeProvider().publishPost("token", {
        caption: "too many",
        media: Array.from({ length: 11 }, (_, i) => ({
          url: `https://cdn/${i}.png`,
          type: "image" as const,
        })),
        extra: { pageId: "999" },
      }),
    ).rejects.toThrow(/at most 10 photos/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("video publish falls back to the bare video id when post_id is not ready", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(graphResponse({ id: "vid-1" }));
    fetchMock.mockRejectedValueOnce(new Error("async processing")); // best-effort fields call
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeProvider().publishPost("token", {
      caption: "clip",
      media: [{ url: "https://cdn/v.mp4", type: "video" }],
      extra: { pageId: "999" },
    });

    expect(result.platformPostId).toBe("vid-1");
    expect(result.permalink).toBe("https://www.facebook.com/vid-1");
  });
});
