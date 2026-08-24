import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LinkedInCompanyProvider,
  LinkedInPersonalProvider,
  LinkedInProvider,
  encodeUrn,
  postUrnToUrl,
} from "./linkedin.provider";

function jsonResponse(json: unknown, headers?: Record<string, string>): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: async () => json,
  } as unknown as Response;
}

describe("urn helpers", () => {
  it("encodes colons for path use (legacy parity)", () => {
    expect(encodeUrn("urn:li:ugcPost:12345")).toBe("urn%3Ali%3AugcPost%3A12345");
  });

  it("converts full URNs to feed URLs; bare ids → null", () => {
    expect(postUrnToUrl("urn:li:share:123")).toBe("https://www.linkedin.com/feed/update/urn:li:share:123/");
    expect(postUrnToUrl("urn:li:ugcPost:9")).toBe("https://www.linkedin.com/feed/update/urn:li:ugcPost:9/");
    expect(postUrnToUrl("123")).toBeNull();
    expect(postUrnToUrl("")).toBeNull();
  });
});

describe("LinkedInProvider", () => {
  const provider = new LinkedInProvider().configure({
    clientId: "cid",
    clientSecret: "sec",
  });

  afterEach(() => vi.unstubAllGlobals());

  it("exchangeCode returns access + refresh tokens (CM apps issue refresh)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 5_184_000,
          scope: "w_member_social",
        }),
      ),
    );

    const tokens = await provider.exchangeCode("code", "cb");
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  it("text post reads x-restli-id and builds the feed URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { "x-restli-id": "urn:li:share:777" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.publishPost("token", {
      caption: "post",
      media: [],
      extra: { author: "urn:li:person:42" },
    });

    expect(result.platformPostId).toBe("urn:li:share:777");
    expect(result.permalink).toBe("https://www.linkedin.com/feed/update/urn:li:share:777/");

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/rest/posts");
    const body = JSON.parse(init.body as string);
    expect(body.author).toBe("urn:li:person:42");
    expect(body.visibility).toBe("PUBLIC");
    expect(body.distribution.feedDistribution).toBe("MAIN_FEED");
    // versioned headers required by the RestLi API
    expect(init.headers).toMatchObject({
      "LinkedIn-Version": "202604",
      "X-Restli-Protocol-Version": "2.0.0",
    });
  });

  it("image posts run init → binary PUT → post with media URN", async () => {
    const fetchMock = vi.fn();
    // init upload
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ value: { uploadUrl: "https://upload/1", image: "urn:li:image:A" } }),
    );
    // bytes fetch from CDN happens first (uploadBinary reads the URL)
    fetchMock.mockResolvedValueOnce(new Response(new ArrayBuffer(4), { status: 200 }));
    // binary PUT
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    // create post
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { "x-restli-id": "urn:li:share:888" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.publishPost("token", {
      caption: "img",
      media: [{ url: "https://cdn/pic.png", type: "image" }],
      extra: { author: "urn:li:person:42" },
    });

    expect(result.platformPostId).toBe("urn:li:share:888");
    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    expect(calls[0]![0]).toContain("/rest/images?action=initializeUpload");
    // call 1 = CDN bytes GET, call 2 = binary PUT to LinkedIn's upload URL
    expect(calls[1]![0]).toBe("https://cdn/pic.png");
    expect(calls[2]![0]).toBe("https://upload/1");
    expect(calls[2]![1]!.method).toBe("PUT");
    const postBody = JSON.parse(calls[3]![1]!.body as string);
    expect(postBody.content.media.id).toBe("urn:li:image:A");
  });
});

describe("LinkedInPersonalProvider (OIDC mode)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("getProfile uses /v2/userinfo and the sub claim as Person ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ sub: "abc123", name: "Bean", picture: "p.png" })),
    );
    const personal = new LinkedInPersonalProvider();
    const profile = await personal.getProfile("token");

    expect(profile.platformAccountId).toBe("abc123");
    expect(profile.displayName).toBe("Bean");
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain("/v2/userinfo");
  });

  it("OIDC scopes exclude community-management permissions", () => {
    const personal = new LinkedInPersonalProvider();
    const authUrl = new URL(personal.getAuthUrl("cb", "s"));
    expect((authUrl.searchParams.get("scope") ?? "").split(" ")).toEqual([
      "openid",
      "profile",
      "email",
      "w_member_social",
    ]);
  });

  it("first comment + metrics are unsupported in OIDC mode (legacy NotImplementedError)", async () => {
    const personal = new LinkedInPersonalProvider();
    expect(() => personal.publishComment("t", "urn:x", "hi")).toThrow(/unsupported in OIDC mode/);
    expect(() => personal.getPostMetrics("t", "urn:x")).toThrow(/personal-profile share statistics/);
  });
});

describe("LinkedInCompanyProvider", () => {
  it("inherits the full CM scope set", () => {
    const company = new LinkedInCompanyProvider().configure({
      clientId: "c",
      clientSecret: "s",
    });
    const companyUrl = new URL(company.getAuthUrl("cb", "s"));
    expect((companyUrl.searchParams.get("scope") ?? "").split(" ")).toEqual([
      "w_member_social",
      "r_member_social",
      "w_organization_social",
      "r_organization_social",
    ]);
  });
});
