import { Injectable } from "@nestjs/common";

import type {
  AccountProfile,
  MediaType,
  OAuthTokens,
  PostContent,
  PostType,
  ProviderCallOptions,
  PublishResult,
  SocialProvider,
} from "@brightbean/shared";
import {
  FACEBOOK_OAUTH_URL,
  GRAPH_BASE_URL,
  MetaApiError,
  fetchInsightsSafe,
  graphGet,
  graphPost,
} from "./meta-graph.client";

/**
 * Port of providers/instagram.py — Instagram Business via Facebook Login.
 * Two-step container publish flow, insights and ID resolution must match
 * the legacy Python provider exactly.
 */

const TOKEN_URL = `${GRAPH_BASE_URL}/oauth/access_token`;

const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
];

const MEDIA_INSIGHTS = [
  "reach",
  "views",
  "likes",
  "comments",
  "saved",
  "shares",
  "total_interactions",
];

const ACCOUNT_INSIGHTS = ["reach", "views", "accounts_engaged", "total_interactions"];

const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_product_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
  "like_count",
  "comments_count",
];

/// Container polling (legacy: 2 s × 60 attempts).
const CONTAINER_POLL_INTERVAL_MS = 2_000;
const CONTAINER_POLL_MAX_ATTEMPTS = 60;

@Injectable()
export class InstagramProvider implements SocialProvider {
  readonly platformName = "instagram" as const;
  readonly maxCaptionLength = 2_200;
  readonly supportedPostTypes: PostType[] = ["image", "video", "carousel"];
  readonly supportedMediaTypes: MediaType[] = ["image", "video"];
  readonly rateLimits = { maxPerWindow: 200, windowSeconds: 3600 };

  private clientId = process.env.PLATFORM_FACEBOOK_APP_ID ?? "";
  private clientSecret = process.env.PLATFORM_FACEBOOK_APP_SECRET ?? "";
  /// Injectable clock for container polling tests.
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
    return `${FACEBOOK_OAUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    return this.tokenExchange({
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    }, "Instagram token exchange failed");
  }

  /// Short-lived → long-lived, identical to the Facebook flow.
  async refreshToken(shortLivedToken: string): Promise<OAuthTokens> {
    const search = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      fb_exchange_token: shortLivedToken,
    });
    const response = await fetch(`${GRAPH_BASE_URL}/oauth/access_token?${search.toString()}`);
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || !body["access_token"]) {
      throw new MetaApiError("Instagram long-lived token exchange failed", response.status, body);
    }
    return {
      accessToken: String(body["access_token"]),
      expiresAt: expiresInToDate(body["expires_in"]),
      tokenType: String(body["token_type"] ?? "Bearer"),
    };
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const igUserId = await this.getIgUserId(accessToken);
    const data = await graphGet(`${GRAPH_BASE_URL}/${igUserId}`, accessToken, {
      fields: "id,username,name,profile_picture_url,followers_count,media_count",
    });
    return {
      platformAccountId: String(data["id"]),
      username: String(data["username"] ?? ""),
      displayName: String(data["name"] ?? ""),
      avatarUrl: (data["profile_picture_url"] as string | undefined) ?? null,
      followers: Number(data["followers_count"] ?? 0),
      meta: data,
    };
  }

  /// Linked IG Business accounts from the Facebook pages the user manages.
  async getUserPages(accessToken: string): Promise<Array<Record<string, unknown>>> {
    const data = await graphGet(`${GRAPH_BASE_URL}/me/accounts`, accessToken, {
      fields:
        "id,name,access_token,category,picture,instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}",
    });

    const accounts: Array<Record<string, unknown>> = [];
    for (const page of ((data["data"] as Array<Record<string, unknown>>) ?? [])) {
      const igAccount = page["instagram_business_account"] as
        | Record<string, unknown>
        | undefined;
      if (!igAccount) continue;

      let pictureUrl = igAccount["profile_picture_url"] as string | undefined;
      if (!pictureUrl) {
        const picture = page["picture"] as Record<string, unknown> | undefined;
        pictureUrl = (picture?.["data"] as Record<string, unknown> | undefined)?.[
          "url"
        ] as string | undefined;
      }

      const username = String(igAccount["username"] ?? "");
      accounts.push({
        id: String(igAccount["id"]),
        name: igAccount["name"] || username || page["name"] || "",
        handle: username,
        category: String(page["category"] ?? ""),
        picture: pictureUrl ?? null,
        followers_count: Number(igAccount["followers_count"] ?? 0),
        page_id: page["id"],
        page_name: page["name"] ?? "",
        ...(page["access_token"] ? { access_token: page["access_token"] } : {}),
      });
    }
    return accounts;
  }

  // ------------------------------------------------------------------
  // Publishing — two-step container flow
  // ------------------------------------------------------------------

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    const igUserId =
      (content.extra?.["igUserId"] as string | undefined) ??
      (content.extra?.["ig_user_id"] as string | undefined) ??
      (await this.getIgUserId(accessToken));

    // Legacy heuristic #118: a single video publishes as an IG Reel.
    const isCarousel = content.media.length > 1 && content.media.every((m) => m.type === "image" || m.type === "video");
    if (isCarousel && content.extra?.["carousel"] === true) {
      return this.publishCarousel(accessToken, igUserId, content);
    }
    return this.publishSingle(accessToken, igUserId, content);
  }

  private async publishSingle(
    accessToken: string,
    igUserId: string,
    content: PostContent,
  ): Promise<PublishResult> {
    const payload: Record<string, unknown> = {};
    if (content.caption) payload.caption = content.caption;

    const firstUrl = content.media[0]?.url ?? "";

    if (content.media[0]?.type === "video") {
      // Standalone feed videos no longer exist: single video → REELS (#118).
      payload.media_type = "REELS";
      payload.video_url = firstUrl;
    } else if (firstUrl.endsWith(".mp4") || firstUrl.endsWith(".mov")) {
      payload.media_type = "REELS";
      payload.video_url = firstUrl;
    } else if (content.extra?.["story"] === true) {
      payload.media_type = "STORIES";
      if (/\.(mp4|mov)$/i.test(firstUrl)) payload.video_url = firstUrl;
      else payload.image_url = firstUrl;
    } else {
      payload.image_url = firstUrl;
    }
    void content.extra;

    const containerId = await this.createContainer(accessToken, igUserId, payload);
    await this.waitForContainer(accessToken, containerId);
    return this.publishContainer(accessToken, igUserId, containerId);
  }

  private async publishCarousel(
    accessToken: string,
    igUserId: string,
    content: PostContent,
  ): Promise<PublishResult> {
    const childIds: string[] = [];
    for (const media of content.media) {
      const isVideo = /\.(mp4|mov)$/i.test(media.url);
      const childPayload: Record<string, unknown> = { is_carousel_item: true };
      if (isVideo) {
        childPayload.media_type = "VIDEO";
        childPayload.video_url = media.url;
      } else {
        childPayload.image_url = media.url;
      }
      const childId = await this.createContainer(accessToken, igUserId, childPayload);
      await this.waitForContainer(accessToken, childId);
      childIds.push(childId);
    }

    const carouselPayload: Record<string, unknown> = {
      media_type: "CAROUSEL",
      children: childIds.join(","),
    };
    if (content.caption) carouselPayload.caption = content.caption;

    const carouselId = await this.createContainer(accessToken, igUserId, carouselPayload);
    await this.waitForContainer(accessToken, carouselId);
    return this.publishContainer(accessToken, igUserId, carouselId);
  }

  private async createContainer(
    accessToken: string,
    igUserId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const data = await graphPost(`${GRAPH_BASE_URL}/${igUserId}/media`, accessToken, payload);
    const containerId = data["id"] ? String(data["id"]) : "";
    if (!containerId) throw new Error("Failed to create Instagram media container");
    return containerId;
  }

  private async waitForContainer(accessToken: string, containerId: string): Promise<void> {
    for (let attempt = 0; attempt < CONTAINER_POLL_MAX_ATTEMPTS; attempt++) {
      const data = await graphGet(`${GRAPH_BASE_URL}/${containerId}`, accessToken, {
        fields: "status_code,status",
      });
      const status = String(data["status_code"] ?? "");

      if (status === "FINISHED") return;
      if (status === "ERROR") {
        throw new Error(`Instagram container failed: ${String(data["status"] ?? "unknown error")}`);
      }
      await this.sleep(CONTAINER_POLL_INTERVAL_MS);
    }
    throw new Error("Instagram container processing timed out");
  }

  private async publishContainer(
    accessToken: string,
    igUserId: string,
    containerId: string,
  ): Promise<PublishResult> {
    const data = await graphPost(`${GRAPH_BASE_URL}/${igUserId}/media_publish`, accessToken, {
      creation_id: containerId,
    });
    const mediaId = String(data["id"] ?? "");
    return {
      platformPostId: mediaId,
      permalink: `https://www.instagram.com/p/${mediaId}/`,
      publishedAt: new Date(),
    };
  }

  // ------------------------------------------------------------------
  // Comments / inbox
  // ------------------------------------------------------------------

  async publishComment(accessToken: string, postId: string, text: string) {
    const data = await graphPost(`${GRAPH_BASE_URL}/${postId}/comments`, accessToken, {
      message: text,
    });
    return { platformCommentId: String(data["id"]) };
  }

  async getMessages(accessToken: string, since?: Date) {
    const igUserId = "me";
    const params = new URLSearchParams({
      fields: "id,participants,messages{id,message,from,created_time}",
    });
    if (since) params.set("since", String(Math.floor(since.getTime() / 1000)));

    const convosRes = await graphGet(
      `${GRAPH_BASE_URL}/${igUserId}/conversations`,
      accessToken,
      Object.fromEntries(params),
    );

    const results: Array<{
      platformMessageId: string; senderPlatformId: string; senderName: string;
      body: string; receivedAt: Date; conversationId?: string;
    }> = [];
    for (const convo of ((convosRes["data"] as Array<Record<string, unknown>>) ?? [])) {
      for (const msg of (((convo["messages"] as Record<string, unknown> | undefined)?.["data"] as Array<Record<string, unknown>>) ?? [])) {
        const from = (msg["from"] ?? {}) as Record<string, unknown>;
        results.push({
          platformMessageId: String(msg["id"]),
          senderPlatformId: String(from["id"] ?? ""),
          senderName: String(from["name"] ?? from["username"] ?? ""),
          body: String(msg["message"] ?? ""),
          receivedAt: new Date(String(msg["created_time"])),
          conversationId: String(convo["id"]),
        });
      }
    }
    return results;
  }

  async replyToMessage(accessToken: string, conversationId: string, text: string) {
    const data = await graphPost(
      `${GRAPH_BASE_URL}/${conversationId}/messages`,
      accessToken,
      { message: text },
    );
    return { platformReplyId: String(data["id"]) };
  }

  // ------------------------------------------------------------------
  // Analytics
  // ------------------------------------------------------------------

  async getPostMetrics(accessToken: string, postId: string) {
    const fields = await this.getMediaFields(accessToken, postId);
    const { values, errors } = await fetchInsightsSafe(graphGet, {
      endpoint: `${GRAPH_BASE_URL}/${postId}/insights`,
      accessToken,
      metrics: MEDIA_INSIGHTS,
    });

    return {
      reach: Number(values["reach"] ?? 0),
      likes: Number(values["likes"] ?? fields["like_count"] ?? 0),
      comments: Number(values["comments"] ?? fields["comments_count"] ?? 0),
      shares: Number(values["shares"] ?? 0),
      collectedAt: new Date(),
      meta: {
        saves: values["saved"] ?? 0,
        videoViews: values["views"] ?? 0,
        totalInteractions: values["total_interactions"] ?? 0,
        rawFields: fields,
        rawInsights: values,
        insightErrors: errors,
      },
    };
  }

  async getAccountMetrics(
    accessToken: string,
    since: Date,
    until: Date,
    options?: ProviderCallOptions,
  ) {
    const igUserId = options?.igUserId ?? "me";
    const { values, errors } = await fetchInsightsSafe(graphGet, {
      endpoint: `${GRAPH_BASE_URL}/${igUserId}/insights`,
      accessToken,
      metrics: ACCOUNT_INSIGHTS,
      baseParams: {
        period: "day",
        since: String(Math.floor(since.getTime() / 1000)),
        until: String(Math.floor(until.getTime() / 1000)),
      },
      metricParams: {
        views: { metric_type: "total_value" },
        accounts_engaged: { metric_type: "total_value" },
        total_interactions: { metric_type: "total_value" },
      },
    });

    const profile = await this.getProfileFields(accessToken, igUserId);
    // null profile means fetch FAILED (vs genuine 0) — don't poison snapshots.
    const followers = profile ? Number(profile["followers_count"] ?? 0) : null;

    return {
      followers,
      followerDelta: null,
      impressions: null,
      reach: Number(values["reach"] ?? 0),
      collectedAt: new Date(),
      meta: {
        views: values["views"] ?? 0,
        accountsEngaged: values["accounts_engaged"] ?? 0,
        totalInteractions: values["total_interactions"] ?? 0,
        rawInsights: values,
        insightErrors: errors,
      },
    };
  }

  revokeToken(): never {
    throw new Error("Revoke handled by revoking the parent Facebook token");
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** Resolve the IG Business Account id from linked pages (legacy parity). */
  private async getIgUserId(accessToken: string): Promise<string> {
    const data = await graphGet(`${GRAPH_BASE_URL}/me/accounts`, accessToken, {
      fields: "id,instagram_business_account",
    });
    for (const page of ((data["data"] as Array<Record<string, unknown>>) ?? [])) {
      const igAccount = page["instagram_business_account"] as Record<string, unknown> | undefined;
      if (igAccount) return String(igAccount["id"]);
    }
    throw new MetaApiError(
      "No Instagram Business Account found linked to any Facebook Page",
      undefined,
      {},
    );
  }

  /** Returns null on failure so callers distinguish failed vs genuine 0. */
  private async getProfileFields(
    accessToken: string,
    igUserId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await graphGet(`${GRAPH_BASE_URL}/${igUserId}`, accessToken, {
        fields: "id,username,name,profile_picture_url,followers_count,media_count",
      });
    } catch {
      return null;
    }
  }

  private async getMediaFields(
    accessToken: string,
    mediaId: string,
  ): Promise<Record<string, unknown>> {
    try {
      return await graphGet(`${GRAPH_BASE_URL}/${mediaId}`, accessToken, {
        fields: MEDIA_FIELDS.join(","),
      });
    } catch {
      return {};
    }
  }

  private async tokenExchange(
    params: Record<string, string>,
    failureMessage: string,
  ): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, { method: "POST", body: new URLSearchParams(params) });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || !body["access_token"]) {
      throw new MetaApiError(failureMessage, response.status, body);
    }
    return {
      accessToken: String(body["access_token"]),
      expiresAt: expiresInToDate(body["expires_in"]),
      tokenType: String(body["token_type"] ?? "Bearer"),
    };
  }
}

function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}
