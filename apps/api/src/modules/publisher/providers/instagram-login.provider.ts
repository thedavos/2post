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
 * Port of providers/instagram_login.py — "Instagram API with Instagram Login"
 * path: separate OAuth from the Facebook-Login variant, uses graph.instagram.com,
 * multipart token exchange, and the access token itself for refresh.
 */

const AUTH_URL = "https://www.instagram.com/oauth/authorize";
const TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH_HOST = "https://graph.instagram.com";
const API_BASE = `${GRAPH_HOST}/v25.0`;

const CONTAINER_POLL_INTERVAL_MS = 2_000;
const CONTAINER_POLL_MAX_ATTEMPTS = 60;

export class PublishError extends Error {}
export class OAuthError extends Error {}

@Injectable()
export class InstagramLoginProvider implements SocialProvider {
  readonly platformName = "instagram_login" as const;
  readonly maxCaptionLength = 2_200;
  readonly supportedPostTypes: PostType[] = ["image", "video", "carousel"];
  readonly supportedMediaTypes: MediaType[] = ["image", "video"];
  readonly rateLimits = { maxPerWindow: 200, windowSeconds: 3600 };

  private clientId = process.env.PLATFORM_INSTAGRAM_APP_ID ?? "";
  private clientSecret = process.env.PLATFORM_INSTAGRAM_APP_SECRET ?? "";
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  configure(credentials?: { clientId?: string; clientSecret?: string }): this {
    if (credentials?.clientId) this.clientId = credentials.clientId;
    if (credentials?.clientSecret) this.clientSecret = credentials.clientSecret;
    return this;
  }

  getAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
      scope: [
        "instagram_business_basic",
        "instagram_business_content_publish",
        "instagram_business_manage_comments",
        "instagram_business_manage_messages",
        "instagram_business_manage_insights",
      ].join(","),
      response_type: "code",
      enable_fb_login: "0",
      force_authentication: "1",
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /// Instagram Login requires multipart/form-data, NOT urlencoded (legacy parity).
  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const form = new FormData();
    form.set("client_id", this.clientId);
    form.set("client_secret", this.clientSecret);
    form.set("code", code);
    form.set("grant_type", "authorization_code");
    form.set("redirect_uri", redirectUri);

    const response = await fetch(TOKEN_URL, { method: "POST", body: form });
    const body = (await response.json()) as Record<string, unknown>;
    const shortLivedToken = body["access_token"] as string | undefined;
    if (!shortLivedToken) {
      throw new OAuthError(`Instagram token exchange failed: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return this.exchangeForLongLivedToken(shortLivedToken);
  }

  /// Short-lived (~1h) → long-lived (~60 days).
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<OAuthTokens> {
    const search = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      access_token: shortLivedToken,
    });
    const body = await getJson(`${GRAPH_HOST}/access_token?${search.toString()}`, "");
    if (!body["access_token"]) {
      throw new OAuthError(
        `Instagram long-lived token exchange failed: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    // Instagram Login uses the access token itself for refresh (legacy parity).
    return tokensFromBody(body);
  }

  async refreshToken(currentAccessToken: string): Promise<OAuthTokens> {
    const search = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: currentAccessToken,
    });
    const body = await getJson(`${GRAPH_HOST}/refresh_access_token?${search.toString()}`, "");
    if (!body["access_token"]) {
      throw new OAuthError(`Instagram token refresh failed: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return tokensFromBody(body);
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const data = await getJson(`${API_BASE}/me`, accessToken, {
      fields: "user_id,username,name,profile_picture_url,followers_count,media_count,biography",
    });
    return {
      platformAccountId: String(data["user_id"] ?? data["id"] ?? ""),
      username: String(data["username"] ?? ""),
      displayName: String(data["name"] || data["username"] || ""),
      avatarUrl: (data["profile_picture_url"] as string | undefined) ?? null,
      followers: Number(data["followers_count"] ?? 0),
      meta: data,
    };
  }

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    if (content.media.length === 0) {
      throw new PublishError("Instagram requires at least one media item");
    }

    if (content.extra?.["carousel"] === true && content.media.length > 1) {
      return this.publishCarousel(accessToken, content);
    }

    // Single image / reel — containers under /me/media (no ig_user_id path).
    const payload: Record<string, unknown> = {};
    if (content.caption) payload.caption = content.caption;
    const firstUrl = content.media[0]!.url;

    if (content.media[0]!.type === "video" || /\.(mp4|mov)$/i.test(firstUrl)) {
      payload.media_type = "REELS";
      payload.video_url = firstUrl;
    } else {
      payload.image_url = firstUrl;
    }

    const containerId = await this.createContainer(accessToken, payload);
    await this.waitForContainer(accessToken, containerId);
    return this.publishContainer(accessToken, containerId);
  }

  private async publishCarousel(accessToken: string, content: PostContent): Promise<PublishResult> {
    const childIds: string[] = [];
    for (const media of content.media) {
      const isVideo = /\.(mp4|mov)$/i.test(media.url) || media.type === "video";
      const childPayload: Record<string, unknown> = isVideo
        ? { media_type: "VIDEO", video_url: media.url }
        : { image_url: media.url };
      childPayload.is_carousel_item = true;

      const childId = await this.createContainer(accessToken, childPayload);
      await this.waitForContainer(accessToken, childId);
      childIds.push(childId);
    }

    const carouselId = await this.createContainer(accessToken, {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: content.caption.slice(0, this.maxCaptionLength),
    });
    await this.waitForContainer(accessToken, carouselId);
    return this.publishContainer(accessToken, carouselId);
  }

  private async createContainer(
    accessToken: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const response = await fetch(`${API_BASE}/me/media`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as Record<string, unknown>;
    const containerId = data["id"] ? String(data["id"]) : "";
    if (!containerId) throw new PublishError("Failed to create Instagram media container");
    return containerId;
  }

  private async waitForContainer(accessToken: string, containerId: string): Promise<void> {
    for (let attempt = 0; attempt < CONTAINER_POLL_MAX_ATTEMPTS; attempt++) {
      const data = await getJson(
        `${API_BASE}/${containerId}?fields=status_code,status`,
        accessToken,
      );
      const status = String(data["status_code"] ?? "");
      if (status === "FINISHED") return;
      if (status === "ERROR") {
        throw new PublishError(`Instagram container failed: ${String(data["status"] ?? "unknown")}`);
      }
      await this.sleep(CONTAINER_POLL_INTERVAL_MS);
    }
    throw new PublishError("Instagram container processing timed out");
  }

  private async publishContainer(accessToken: string, containerId: string): Promise<PublishResult> {
    const response = await fetch(`${API_BASE}/me/media_publish`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ creation_id: containerId }),
    });
    const data = (await response.json()) as Record<string, unknown>;
    const mediaId = String(data["id"] ?? "");
    return {
      platformPostId: mediaId,
      permalink: `https://www.instagram.com/p/${mediaId}/`,
      publishedAt: new Date(),
    };
  }

  publishComment(): never {
    throw new Error("IG-Login comment publishing lands with the inbox phase");
  }
  getPostMetrics(): never {
    throw new Error("Instagram Login insights land with the analytics phase");
  }
  getAccountMetrics(): never {
    throw new Error("Instagram Login account insights land with the analytics phase");
  }
}

function tokensFromBody(body: Record<string, unknown>): OAuthTokens {
  const token = String(body["access_token"]);
  return {
    accessToken: token,
    refreshToken: token, // the access token IS the refresh token (legacy parity)
    expiresAt: expiresInToDate(body["expires_in"]),
    tokenType: String(body["token_type"] ?? "Bearer"),
  };
}

function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

async function getJson(
  url: string,
  accessToken: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const search = new URLSearchParams(params ?? {});
  const separator = url.includes("?") ? "&" : "?";
  const target = params && Object.keys(params).length > 0 ? `${url}${separator}${search.toString()}` : url;
  const response = await fetch(target, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  return (await response.json()) as Record<string, unknown>;
}
