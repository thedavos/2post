import { Injectable } from "@nestjs/common";

import type {
  AccountProfile,
  PlatformSlug,
  MediaType,
  OAuthTokens,
  PostContent,
  PostType,
  ProviderCallOptions,
  PublishResult,
  SocialProvider,
} from "@brightbean/shared";

/**
 * Port of providers/linkedin.py — Marketing API v2 (RestLi).
 * Headers, URN handling and upload flows must match the legacy Python
 * provider exactly.
 */

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const REVOKE_URL = "https://www.linkedin.com/oauth/v2/revoke";
const API_BASE = "https://api.linkedin.com";

/// LinkedIn sunsets versioned APIs after ~1 year; bump before it falls out.
const LINKEDIN_HEADERS: Record<string, string> = {
  "LinkedIn-Version": "202604",
  "X-Restli-Protocol-Version": "2.0.0",
};

export class PublishError extends Error {}
export class OAuthError extends Error {}

/** Percent-encode a LinkedIn URN for URL path use ("urn%3Ali%3AugcPost%3A1"). */
export function encodeUrn(urn: string): string {
  return encodeURIComponent(urn).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** urn:li:share:123 → https://www.linkedin.com/feed/update/urn:li:share:123/ */
export function postUrnToUrl(urn: string): string | null {
  if (!urn) return null;
  return urn.split(":").length >= 4 ? `https://www.linkedin.com/feed/update/${urn}/` : null;
}

@Injectable()
export class LinkedInProvider implements SocialProvider {
  readonly platformName: PlatformSlug = "linkedin";
  readonly maxCaptionLength = 3000;
  readonly supportedPostTypes: PostType[] = ["text", "image", "video", "link", "article"];
  readonly supportedMediaTypes: MediaType[] = ["image", "video"];
  readonly rateLimits = { maxPerWindow: 100, windowSeconds: 3600 };

  protected clientId = process.env.PLATFORM_LINKEDIN_CLIENT_ID ?? "";
  protected clientSecret = process.env.PLATFORM_LINKEDIN_CLIENT_SECRET ?? "";

  configure(credentials?: { clientId?: string; clientSecret?: string }): this {
    if (credentials?.clientId) this.clientId = credentials.clientId;
    if (credentials?.clientSecret) this.clientSecret = credentials.clientSecret;
    return this;
  }

  /** Overridden by the OIDC personal variant. */
  protected get scopes(): string[] {
    return ["w_member_social", "r_member_social", "w_organization_social", "r_organization_social"];
  }

  getAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
      scope: this.scopes.join(" "),
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    return this.tokenForm({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    }, "LinkedIn token exchange failed");
  }

  async refreshToken(refreshTokenValue: string): Promise<OAuthTokens> {
    return this.tokenForm({
      grant_type: "refresh_token",
      refresh_token: refreshTokenValue,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    }, "LinkedIn token refresh failed");
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const data = await restGet(`${API_BASE}/v2/me`, accessToken);
    const first = String(data["localizedFirstName"] ?? "");
    const last = String(data["localizedLastName"] ?? "");
    const picture = data["profilePicture"] as Record<string, unknown> | undefined;
    return {
      platformAccountId: String(data["id"] ?? ""),
      username: "",
      displayName: `${first} ${last}`.trim() || String(data["vanityName"] ?? ""),
      avatarUrl: (picture?.["displayImage"] as string | undefined) ?? null,
      meta: data,
    };
  }

  // ------------------------------------------------------------------
  // Publishing
  // ------------------------------------------------------------------

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    let author = content.extra?.["author"] as string | undefined;
    if (!author) {
      const profile = await this.getProfile(accessToken);
      author = `urn:li:person:${profile.platformAccountId}`;
    }

    const firstMedia = content.media[0];
    if (firstMedia?.type === "image") {
      return this.publishImagePost(accessToken, author, content, firstMedia.url);
    }
    if (firstMedia?.type === "video") {
      return this.publishVideoPost(accessToken, author, content, firstMedia.url);
    }
    return this.publishTextPost(accessToken, author, content);
  }

  protected buildPostBody(author: string, commentary: string): Record<string, unknown> {
    return {
      author,
      commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
    };
  }

  protected async publishTextPost(
    accessToken: string,
    author: string,
    content: PostContent,
  ): Promise<PublishResult> {
    const body = this.buildPostBody(author, content.caption);

    const linkUrl = content.extra?.["linkUrl"] as string | undefined;
    if (linkUrl) {
      body["content"] = {
        article: {
          source: linkUrl,
          title: content.title ?? "",
          description: (content.extra?.["description"] as string) ?? "",
        },
      };
    }
    return this.createPost(accessToken, body);
  }

  /// Step 1 init → Step 2 binary PUT → Step 3 post with image URN.
  protected async publishImagePost(
    accessToken: string,
    author: string,
    content: PostContent,
    imageUrl: string,
  ): Promise<PublishResult> {
    const initData = await restPostAction(`${API_BASE}/rest/images`, accessToken, "initializeUpload", {
      initializeUploadRequest: { owner: author },
    });
    const value = (initData["value"] ?? {}) as Record<string, unknown>;
    const uploadUrl = String(value["uploadUrl"] ?? "");
    const imageUrn = String(value["image"] ?? "");
    if (!uploadUrl || !imageUrn) throw new PublishError("Failed to initialize LinkedIn image upload");

    await uploadBinary(accessToken, uploadUrl, imageUrl);

    const body = this.buildPostBody(author, content.caption);
    body["content"] = { media: { id: imageUrn } };
    const result = await this.createPost(accessToken, body);
    return { ...result, meta: { urn: result.platformPostId, image_urn: imageUrn } };
  }

  /**
   * Videos REST flow: init with fileSizeBytes → chunked PUTs collecting ETags
   * → finalizeUpload → poll AVAILABLE → create post. The new stack streams
   * from a fetched URL instead of disk.
   */
  protected async publishVideoPost(
    accessToken: string,
    author: string,
    content: PostContent,
    videoUrl: string,
  ): Promise<PublishResult> {
    const bytes = await fetchBytes(videoUrl);
    const fileSizeBytes = bytes.byteLength;

    const initData = await restPostAction(`${API_BASE}/rest/videos`, accessToken, "initializeUpload", {
      initializeUploadRequest: { owner: author, fileSizeBytes },
    });
    const value = (initData["value"] ?? {}) as Record<string, unknown>;
    const videoUrn = String(value["video"] ?? "");
    const uploadInstructions =
      ((value["uploadInstructions"] as Array<Record<string, unknown>>) ?? []);
    const uploadToken = value["uploadToken"] ?? "";
    if (!videoUrn || uploadInstructions.length === 0) {
      throw new PublishError("Failed to initialize LinkedIn video upload");
    }

    const uploadedPartIds: string[] = [];
    for (const instruction of uploadInstructions) {
      const chunkUrl = String(instruction["uploadUrl"] ?? "");
      const firstByte = Number(instruction["firstByte"]);
      const lastByte = Number(instruction["lastByte"]);
      if (!chunkUrl || Number.isNaN(firstByte) || Number.isNaN(lastByte)) {
        throw new PublishError("LinkedIn upload instruction is missing required fields");
      }
      const chunk = bytes.subarray(firstByte, lastByte + 1);
      uploadedPartIds.push(await uploadVideoChunk(chunkUrl, accessToken, chunk));
    }

    await restPostAction(`${API_BASE}/rest/videos`, accessToken, "finalizeUpload", {
      finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds },
    });

    // Posting before AVAILABLE returns MEDIA_ASSET_WAITING_UPLOAD — poll first.
    await this.waitForVideoAvailable(accessToken, videoUrn);

    const body = this.buildPostBody(author, content.caption);
    body["content"] = { media: { id: videoUrn } };
    const result = await this.createPost(accessToken, body);
    return { ...result, meta: { urn: result.platformPostId, video_urn: videoUrn } };
  }

  private async waitForVideoAvailable(accessToken: string, videoUrn: string): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const data = await restGet(`${API_BASE}/rest/videos/${encodeUrn(videoUrn)}`, accessToken);
      const status = String((data["status"] ?? data["processingStatus"] ?? ""));
      if (status === "AVAILABLE") return;
      await sleep(5000);
    }
    throw new PublishError("LinkedIn video processing timed out");
  }

  async publishComment(
    accessToken: string,
    postId: string,
    text: string,
    options?: ProviderCallOptions,
  ) {
    const actor =
      options?.pageId ? `urn:li:organization:${options.pageId}` : `urn:li:person:${(await this.getProfile(accessToken)).platformAccountId}`;

    const response = await rawFetch(
      `${API_BASE}/rest/socialActions/${encodeUrn(postId)}/comments`,
      {
        method: "POST",
        headers: authJsonHeaders(accessToken),
        body: JSON.stringify({ actor, message: { text } }),
      },
    );
    const commentUrn = response.headers.get("x-restli-id") ?? "";
    const data = (await response.json()) as Record<string, unknown>;
    void data;
    return { platformCommentId: commentUrn };
  }

  /// Company-page share statistics only (personal profiles have no analytics).
  async getPostMetrics(accessToken: string, postId: string) {
    const search = new URLSearchParams({ q: "organizationalEntity", "shares[0]": postId });
    const data = await restGet(
      `${API_BASE}/rest/organizationalEntityShareStatistics?${search.toString()}`,
      accessToken,
    );
    const elements = ((data["elements"] as Array<Record<string, unknown>>) ?? []);
    if (elements.length === 0) {
      return { impressions: 0, likes: 0, comments: 0, shares: 0, collectedAt: new Date(), meta: { raw: data } };
    }
    const stats = (elements[0]!["totalShareStatistics"] ?? {}) as Record<string, number>;
    return {
      impressions: stats["impressionCount"] ?? 0,
      likes: stats["likeCount"] ?? 0,
      comments: stats["commentCount"] ?? 0,
      shares: stats["shareCount"] ?? 0,
      collectedAt: new Date(),
      meta: { clicks: stats["clickCount"] ?? 0, engagements: stats["engagementCount"] ?? 0, rawStatistics: stats },
    };
  }

  getAccountMetrics(): never {
    throw new Error("LinkedIn account analytics are Company-only and land with the analytics phase");
  }

  async revokeToken(accessToken: string): Promise<boolean> {
    try {
      await postForm(REVOKE_URL, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        token: accessToken,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async tokenForm(params: Record<string, string>, failureMessage: string): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok || !data["access_token"]) {
      throw new OAuthError(failureMessage);
    }
    return {
      accessToken: String(data["access_token"]),
      refreshToken: data["refresh_token"] ? String(data["refresh_token"]) : undefined,
      expiresAt: expiresInToDate(data["expires_in"]),
      tokenType: String(data["token_type"] ?? "Bearer"),
      scope: data["scope"] ? String(data["scope"]) : undefined,
    };
  }

  private async createPost(
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<PublishResult> {
    const response = await rawFetch(`${API_BASE}/rest/posts`, {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new PublishError(`LinkedIn post creation failed: HTTP ${response.status}`);
    const postUrn = response.headers.get("x-restli-id") ?? "";
    return {
      platformPostId: postUrn,
      permalink: postUrnToUrl(postUrn),
      publishedAt: new Date(),
    };
  }
}

// ---------------------------------------------------------------------
// LinkedIn variants (providers/linkedin_personal.py / _company.py)
// ---------------------------------------------------------------------

/**
 * OIDC mode: dev app has only "Sign In with LinkedIn using OpenID Connect" +
 * "Share on LinkedIn". Profile via /v2/userinfo (`sub` is empirically the
 * member Person ID), no inbox, no first-comment, no refresh tokens (~60 days).
 */
@Injectable()
export class LinkedInPersonalProvider extends LinkedInProvider {
  override readonly platformName: PlatformSlug = "linkedin_personal";

  oauthMode: "oidc" | "community_management" =
    (process.env.LINKEDIN_OAUTH_MODE as "oidc" | "community_management") ?? "oidc";

  protected override get scopes(): string[] {
    return this.oauthMode === "oidc"
      ? ["openid", "profile", "email", "w_member_social"]
      : ["r_basicprofile", "w_member_social", "r_member_social"];
  }

  override async getProfile(accessToken: string): Promise<AccountProfile> {
    if (this.oauthMode !== "oidc") return super.getProfile(accessToken);
    const data = await restGet(`${API_BASE}/v2/userinfo`, accessToken);
    return {
      platformAccountId: String(data["sub"] ?? ""),
      username: "",
      displayName: String(data["name"] ?? ""),
      avatarUrl: (data["picture"] as string | undefined) ?? null,
      meta: data,
    };
  }

  override publishComment(..._args: Parameters<LinkedInProvider["publishComment"]>): never {
    throw new Error(
      "First comment is unsupported in OIDC mode: socialActions.CREATE requires Community Management API approval.",
    );
  }

  override getPostMetrics(..._args: Parameters<LinkedInProvider["getPostMetrics"]>): never {
    throw new Error("LinkedIn does not expose personal-profile share statistics via the REST API.");
  }

  override getAccountMetrics(): never {
    throw new Error("LinkedIn does not expose personal-profile account analytics via the REST API.");
  }
}

/** Company Pages variant: same engine, organization author URNs by default. */
@Injectable()
export class LinkedInCompanyProvider extends LinkedInProvider {
  override readonly platformName: PlatformSlug = "linkedin_company";
}

// ---------------------------------------------------------------------
// http helpers
// ---------------------------------------------------------------------

function authJsonHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    ...LINKEDIN_HEADERS,
    "content-type": "application/json",
  };
}

async function restGet(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(url.startsWith("?") ? url : url, {
    headers: { authorization: `Bearer ${accessToken}`, ...LINKEDIN_HEADERS },
  });
  if (!response.ok) throw new PublishError(`LinkedIn request failed: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function restPostAction(
  baseUrl: string,
  accessToken: string,
  action: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}?action=${action}`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new PublishError(`LinkedIn ${action} failed: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function uploadBinary(accessToken: string, uploadUrl: string, sourceUrl: string): Promise<void> {
  const mediaBytes = await fetchBytes(sourceUrl);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/octet-stream",
      ...LINKEDIN_HEADERS,
    },
    body: new Uint8Array(mediaBytes),
  });
  if (!response.ok) throw new PublishError(`LinkedIn media upload failed: ${response.status}`);
}

async function uploadVideoChunk(
  chunkUrl: string,
  accessToken: string,
  chunk: Uint8Array,
): Promise<string> {
  const response = await fetch(chunkUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/octet-stream",
      ...LINKEDIN_HEADERS,
    },
    body: new Uint8Array(chunk),
  });
  if (!response.ok) throw new PublishError(`LinkedIn video chunk upload failed: ${response.status}`);
  return response.headers.get("etag") ?? "";
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new PublishError(`Could not fetch media ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return (await response.json()) as Record<string, unknown>;
}

async function rawFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}
