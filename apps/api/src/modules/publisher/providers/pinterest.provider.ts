import { Injectable } from "@nestjs/common";

import type {
  AccountProfile,
  MediaType,
  OAuthTokens,
  PostContent,
  PostType,
  PublishResult,
  SocialProvider,
} from "@brightbean/shared";

/**
 * Port of providers/pinterest.py — Pinterest API v5 pins.
 */

const AUTH_URL = "https://www.pinterest.com/oauth/";
const API_BASE = process.env.PINTEREST_API_BASE || "https://api.pinterest.com/v5";
const TOKEN_URL = `${API_BASE}/oauth/token`;

export class PublishError extends Error {}
export class OAuthError extends Error {}

@Injectable()
export class PinterestProvider implements SocialProvider {
  readonly platformName = "pinterest" as const;
  readonly maxCaptionLength = 500;
  readonly supportedPostTypes: PostType[] = ["image", "video"];
  readonly supportedMediaTypes: MediaType[] = ["image", "video"];
  readonly rateLimits = { maxPerWindow: 25, windowSeconds: 3600 };

  private clientId = process.env.PLATFORM_PINTEREST_APP_ID ?? "";
  private clientSecret = process.env.PLATFORM_PINTEREST_APP_SECRET ?? "";

  configure(credentials?: { clientId?: string; clientSecret?: string }): this {
    if (credentials?.clientId) this.clientId = credentials.clientId;
    if (credentials?.clientSecret) this.clientSecret = credentials.clientSecret;
    return this;
  }

  private basicAuthHeader(): Record<string, string> {
    const encoded = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }

  getAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
      scope: ["user_accounts:read", "boards:read", "pins:read", "pins:write"].join(","),
      response_type: "code",
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const body = await tokenForm(
      { code, redirect_uri: redirectUri, grant_type: "authorization_code" },
      this.basicAuthHeader(),
    );
    if (!body["access_token"]) throw new OAuthError(`Pinterest token exchange failed: ${JSON.stringify(body).slice(0, 200)}`);
    return tokensFromBody(body);
  }

  async refreshToken(refreshTokenValue: string): Promise<OAuthTokens> {
    const body = await tokenForm(
      { refresh_token: refreshTokenValue, grant_type: "refresh_token" },
      this.basicAuthHeader(),
    );
    if (!body["access_token"]) throw new OAuthError(`Pinterest token refresh failed: ${JSON.stringify(body).slice(0, 200)}`);
    // Keep the existing refresh token when Google-style non-rotation occurs.
    return tokensFromBody(body, refreshTokenValue);
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const body = await apiGetJson(`${API_BASE}/user_account`, accessToken);
    return {
      platformAccountId: String(body["id"] ?? ""),
      username: String(body["username"] ?? ""),
      displayName: String(body["business_name"] || body["username"] || ""),
      avatarUrl: (body["profile_image"] as string | undefined) ?? null,
      followers: Number(body["follower_count"] ?? 0),
      meta: body,
    };
  }

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    const extra = content.extra ?? {};
    const boardId = extra["board_id"] as string | undefined;
    if (!boardId) throw new PublishError("board_id is required in content.extra for Pinterest pins");

    const payload: Record<string, unknown> = {
      board_id: boardId,
      description: content.caption.slice(0, this.maxCaptionLength),
    };
    if (content.title) payload.title = content.title.slice(0, 100);
    if (extra["linkUrl"]) payload.link = extra["linkUrl"];
    if (extra["alt_text"]) payload.alt_text = String(extra["alt_text"]).slice(0, 500);

    const firstUrl = content.media[0]?.url ?? "";
    if (content.media.length === 0 || !firstUrl) {
      throw new PublishError("No media provided for Pinterest pin");
    }
    if (extra["is_video"] === true) {
      return this.publishVideoPin(accessToken, content, payload);
    }

    payload.media_source = { source_type: "image_url", url: firstUrl };

    const body = await apiPostJson(`${API_BASE}/pins`, accessToken, payload);
    const pinId = String(body["id"] ?? "");
    return {
      platformPostId: pinId,
      permalink: pinId ? `https://www.pinterest.com/pin/${pinId}/` : null,
      publishedAt: new Date(),
      meta: { raw: body },
    };
  }

  private async publishVideoPin(
    accessToken: string,
    content: PostContent,
    payload: Record<string, unknown>,
  ): Promise<PublishResult> {
    // Step 1: register the media upload
    const mediaBody = await apiPostJson(`${API_BASE}/media`, accessToken, {
      media_type: "video",
    });
    const mediaId = String(mediaBody["media_id"] ?? "");
    const uploadUrl = mediaBody["upload_url"] as string | undefined;

    if (uploadUrl && content.media[0]) {
      // Step 2: upload video bytes to Pinterest's upload URL
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": "video/mp4" },
        body: new Uint8Array(await fetchBytes(content.media[0].url)),
      });
      if (!response.ok) throw new PublishError(`Pinterest video upload failed: HTTP ${response.status}`);
    } else if (!mediaId) {
      throw new PublishError("Pinterest media registration failed");
    }

    // Step 3: create the pin referencing the media id
    payload.media_source = { source_type: "video_id", cover_image_url: content.extra?.["cover_image_url"], media_id: mediaId };

    const body = await apiPostJson(`${API_BASE}/pins`, accessToken, payload);
    const pinId = String(body["id"] ?? "");
    return {
      platformPostId: pinId,
      permalink: pinId ? `https://www.pinterest.com/pin/${pinId}/` : null,
      publishedAt: new Date(),
      meta: { raw: body },
    };
  }

  publishComment(): never {
    throw new Error("Pinterest does not support comment publishing");
  }
  getPostMetrics(): never {
    throw new Error("Pinterest metrics land with the analytics phase (pins analytics endpoint)");
  }
  getAccountMetrics(): never {
    throw new Error("Pinterest account metrics land with the analytics phase");
  }
}

function tokensFromBody(body: Record<string, unknown>, fallbackRefresh?: string): OAuthTokens {
  return {
    accessToken: String(body["access_token"]),
    refreshToken: body["refresh_token"] ? String(body["refresh_token"]) : (fallbackRefresh ?? undefined),
    expiresAt: expiresInToDate(body["expires_in"]),
    scope: body["scope"] ? String(body["scope"]) : undefined,
  };
}

function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

async function tokenForm(
  params: Record<string, string>,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return (await response.json()) as Record<string, unknown>;
}

async function apiGetJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  return (await response.json()) as Record<string, unknown>;
}

async function apiPostJson(url: string, accessToken: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return (await response.json()) as Record<string, unknown>;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new PublishError(`Could not fetch media ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
