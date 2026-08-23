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
 * Port of providers/threads.py — Threads API via OAuth 2.0.
 * Container polling semantics matter: publishing a media container before
 * FINISHED fails with "media not found" (code 24) on Meta's side.
 */

const AUTH_URL = "https://www.threads.com/oauth/authorize";
const TOKEN_URL = "https://graph.threads.net/oauth/access_token";
const API_BASE = "https://graph.threads.net/v1.0";

/// 3 s × 40 attempts ≈ 2 min for video processing (legacy cadence).
const CONTAINER_POLL_INTERVAL_MS = 3_000;
const CONTAINER_POLL_MAX_ATTEMPTS = 40;

const SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
  "threads_manage_replies",
];

export class PublishError extends Error {}
export class OAuthError extends Error {}

@Injectable()
export class ThreadsProvider implements SocialProvider {
  readonly platformName = "threads" as const;
  readonly maxCaptionLength = 500;
  readonly supportedPostTypes: PostType[] = ["text", "image", "video", "carousel"];
  readonly supportedMediaTypes: MediaType[] = ["image", "video"];
  readonly rateLimits = { maxPerWindow: 250, windowSeconds: 3600 };

  private clientId = process.env.PLATFORM_THREADS_APP_ID ?? "";
  private clientSecret = process.env.PLATFORM_THREADS_APP_SECRET ?? "";
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
      scope: SCOPES.join(","),
      response_type: "code",
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    let shortLived: Record<string, unknown>;
    try {
      shortLived = await postForm(TOKEN_URL, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      });
    } catch (error) {
      throw new OAuthError(
        `Threads token exchange failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!shortLived["access_token"]) {
      throw new OAuthError(
        `Threads token exchange failed: ${JSON.stringify(shortLived).slice(0, 200)}`,
      );
    }
    return this.exchangeForLongLivedToken(String(shortLived["access_token"]));
  }

  /// th_exchange_token: short-lived → long-lived.
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<OAuthTokens> {
    const body = await getJson(`${API_BASE}/access_token`, "", {
      grant_type: "th_exchange_token",
      client_secret: this.clientSecret,
      access_token: shortLivedToken,
    });
    if (!body["access_token"]) {
      throw new OAuthError(`Threads long-lived token exchange failed: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return tokensFromBody(body);
  }

  /// The access token itself is used for refresh (no separate refresh token).
  async refreshToken(currentAccessToken: string): Promise<OAuthTokens> {
    const body = await getJson(`${API_BASE}/refresh_access_token`, "", {
      grant_type: "th_refresh_token",
      access_token: currentAccessToken,
    });
    if (!body["access_token"]) {
      throw new OAuthError(`Threads token refresh failed: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return tokensFromBody(body);
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const body = await getJson(`${API_BASE}/me`, accessToken, {
      fields: "id,username,name,threads_profile_picture_url,threads_biography",
    });
    return {
      platformAccountId: String(body["id"] ?? ""),
      username: String(body["username"] ?? ""),
      displayName: String(body["name"] ?? ""),
      avatarUrl: (body["threads_profile_picture_url"] as string | undefined) ?? null,
      meta: { biography: body["threads_biography"] },
    };
  }

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    let userId = content.extra?.["user_id"] as string | undefined;
    if (!userId) userId = (await this.getProfile(accessToken)).platformAccountId;
    if (!userId) throw new PublishError("Could not determine Threads user_id");

    // Carousel when explicitly requested; otherwise single-item thread.
    if (content.extra?.["carousel"] === true && content.media.length > 0) {
      return this.publishCarousel(accessToken, userId, content);
    }
    return this.publishSingle(accessToken, userId, content);
  }

  private async publishSingle(
    accessToken: string,
    userId: string,
    content: PostContent,
  ): Promise<PublishResult> {
    const containerPayload: Record<string, unknown> = {
      text: content.caption.slice(0, this.maxCaptionLength),
    };

    const firstUrl = content.media[0]?.url ?? "";
    if (firstUrl && content.media[0]!.type === "image") {
      containerPayload.media_type = "IMAGE";
      containerPayload.image_url = firstUrl;
    } else if (firstUrl && content.media[0]!.type === "video") {
      containerPayload.media_type = "VIDEO";
      containerPayload.video_url = firstUrl;
    } else {
      containerPayload.media_type = "TEXT";
    }

    const replyTo = content.extra?.["reply_to_id"];
    if (replyTo) containerPayload.reply_to_id = replyTo;

    const created = await postFormAuth(
      `${API_BASE}/${userId}/threads`,
      toFormStrings(containerPayload),
      accessToken,
    );
    const creationId = String(created["id"] ?? "");
    if (!creationId) throw new PublishError("Threads container creation failed");

    // Media containers ingest asynchronously — publishing too early fails
    // with "media not found". Text-only threads publish instantly.
    if (containerPayload.media_type !== "TEXT") {
      await this.waitForContainer(accessToken, creationId);
    }

    return this.publishContainer(accessToken, userId, creationId);
  }

  private async waitForContainer(accessToken: string, creationId: string): Promise<void> {
    for (let attempt = 0; attempt < CONTAINER_POLL_MAX_ATTEMPTS; attempt++) {
      const data = await getJson(`${API_BASE}/${creationId}`, accessToken, {
        fields: "status,error_message",
      });
      const status = String(data["status"] ?? "");

      if (status === "FINISHED" || status === "PUBLISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new PublishError(`Threads container failed: ${String(data["error_message"] ?? status)}`);
      }
      await this.sleep(CONTAINER_POLL_INTERVAL_MS);
    }
    throw new PublishError("Threads container processing timed out");
  }

  private async publishCarousel(
    accessToken: string,
    userId: string,
    content: PostContent,
  ): Promise<PublishResult> {
    const childrenIds: string[] = [];

    for (const media of content.media) {
      const isVideo = /\.(mp4|mov)$/i.test(media.url);
      const payload: Record<string, string> = isVideo
        ? { media_type: "VIDEO", video_url: media.url }
        : { media_type: "IMAGE", image_url: media.url };
      payload.is_carousel_item = "true";

      const itemBody = await postFormAuth(`${API_BASE}/${userId}/threads`, payload, accessToken);
      const itemId = String(itemBody["id"] ?? "");
      if (!itemId) throw new PublishError("Threads carousel item creation failed");
      // Video children must finish ingesting before the carousel references them.
      if (isVideo) await this.waitForContainer(accessToken, itemId);
      childrenIds.push(itemId);
    }

    const carouselBody = await postFormAuth(
      `${API_BASE}/${userId}/threads`,
      {
        media_type: "CAROUSEL",
        children: childrenIds.join(","),
        text: content.caption.slice(0, this.maxCaptionLength),
      },
      accessToken,
    );
    const creationId = String(carouselBody["id"] ?? "");
    if (!creationId) throw new PublishError("Threads carousel container creation failed");

    await this.waitForContainer(accessToken, creationId);
    return this.publishContainer(accessToken, userId, creationId);
  }

  private async publishContainer(
    accessToken: string,
    userId: string,
    creationId: string,
  ): Promise<PublishResult> {
    const published = await postFormAuth(
      `${API_BASE}/${userId}/threads_publish`,
      { creation_id: creationId },
      accessToken,
    );
    const threadId = String(published["id"] ?? "");
    return { platformPostId: threadId, permalink: null, publishedAt: new Date() };
  }

  /// Replies use the container flow with reply_to_id (legacy parity).
  async publishComment(accessToken: string, postId: string, text: string) {
    const me = await getJson(`${API_BASE}/me`, accessToken, { fields: "id" });
    const userId = String(me["id"] ?? "");

    const created = await postFormAuth(
      `${API_BASE}/${userId}/threads`,
      {
        media_type: "TEXT",
        text: text.slice(0, this.maxCaptionLength),
        reply_to_id: postId,
      },
      accessToken,
    );
    const creationId = String(created["id"] ?? "");
    if (!creationId) throw new PublishError("Threads reply container creation failed");

    const published = await postFormAuth(
      `${API_BASE}/${userId}/threads_publish`,
      { creation_id: creationId },
      accessToken,
    );
    return { platformCommentId: String(published["id"] ?? "") };
  }

  async getPostMetrics(accessToken: string, postId: string) {
    const body = await getJson(`${API_BASE}/${postId}/insights`, accessToken, {
      metric: "views,likes,replies,reposts,quotes",
    });

    const metrics: Record<string, number> = {};
    for (const item of ((body["data"] as Array<Record<string, unknown>>) ?? [])) {
      const name = String(item["name"] ?? "");
      const values = (item["values"] as Array<Record<string, unknown>> | undefined) ?? [];
      if (values.length > 0) metrics[name] = Number(values[0]!["value"] ?? 0);
    }

    return {
      impressions: metrics["views"] ?? 0,
      likes: metrics["likes"] ?? 0,
      comments: metrics["replies"] ?? 0,
      shares: metrics["reposts"] ?? 0,
      collectedAt: new Date(),
      meta: {
        quotes: metrics["quotes"] ?? 0,
        engagements:
          (metrics["likes"] ?? 0) +
          (metrics["replies"] ?? 0) +
          (metrics["reposts"] ?? 0) +
          (metrics["quotes"] ?? 0),
        raw: body["data"],
      },
    };
  }

  getAccountMetrics(): never {
    throw new Error("Threads does not expose account-level metrics");
  }
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function tokensFromBody(body: Record<string, unknown>): OAuthTokens {
  return {
    accessToken: String(body["access_token"]),
    expiresAt: expiresInToDate(body["expires_in"]),
    tokenType: String(body["token_type"] ?? "Bearer"),
  };
}

function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

function toFormStrings(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
}

async function requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || body["error"]) {
    throw new PublishError(
      `Threads request failed HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return body;
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  return requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
}

async function postFormAuth(
  url: string,
  params: Record<string, string>,
  accessToken: string,
): Promise<Record<string, unknown>> {
  return requestJson(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
}

async function getJson(
  url: string,
  accessToken: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const search = new URLSearchParams(params ?? {});
  const separator = url.includes("?") ? "&" : "?";
  return requestJson(url + (params ? `${separator}${search.toString()}` : ""), {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}
