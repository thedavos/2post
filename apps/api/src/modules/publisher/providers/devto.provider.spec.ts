import { describe, expect, it, vi } from "vitest";

import {
  DevtoProvider,
  PublishError,
  extractTags,
} from "./devto.provider";

const provider = new DevtoProvider();

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json,
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("DevtoProvider", () => {
  const token = "api-key-123";

  it("getProfile maps /users/me to AccountProfile", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: {
          id: 41,
          username: "bean",
          name: "Bright Bean",
          profile_image_90: "https://img/90.png",
        },
      },
    ]);

    const profile = await provider.getProfile(token);

    expect(profile).toMatchObject({
      platformAccountId: "41",
      username: "bean",
      displayName: "Bright Bean",
      avatarUrl: "https://img/90.png",
      followers: 0,
    });
    // api-key header, not Bearer (legacy parity)
    const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].headers;
    expect(headers["api-key"]).toBe(token);
    expect(headers.accept).toBe("application/vnd.forem.api-v1+json");
  });

  it("publishPost creates a published article with title/body/tags", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { id: 987, url: "https://dev.to/u/art-987" } },
    ]);

    const result = await provider.publishPost(token, {
      caption: "Hello **world** #TypeScript and #web",
      title: "My Article",
      media: [{ url: "https://cdn/cover.png", type: "image" }],
      extra: {},
    });

    expect(result.platformPostId).toBe("987");
    expect(result.permalink).toBe("https://dev.to/u/art-987");

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://dev.to/api/articles");
    const body = JSON.parse(init.body as string).article;
    expect(body.title).toBe("My Article");
    expect(body.body_markdown).toBe("Hello **world** #TypeScript and #web");
    expect(body.published).toBe(true);
    expect(body.tags).toEqual(["typescript", "web"]);
    expect(body.main_image).toBe("https://cdn/cover.png");
  });

  it("publishPost requires a title (legacy PublishError)", async () => {
    await expect(
      provider.publishPost(token, { caption: "no title", media: [] }),
    ).rejects.toBeInstanceOf(PublishError);
  });

  it("extractTags cleans, dedupes and caps at 4 Forem-valid tags", () => {
    expect(
      extractTags({
        caption: "#TypeScript #web!! #web #reactjs #vue #svelte",
        media: [],
      }),
    ).toEqual(["typescript", "web", "reactjs", "vue"]);
    expect(extractTags({ caption: "no tags here", media: [], extra: { tags: ["Go"] } })).toEqual([
      "go",
    ]);
  });
});
