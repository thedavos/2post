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
  parseInsightsResponse,
} from "./meta-graph.client";

/**
 * Port of providers/facebook.py — Graph API v25.0 page publishing.
 * Request shapes, ID handling and error semantics must match the legacy
 * Python provider exactly.
 */

const TOKEN_URL = `${GRAPH_BASE_URL}/oauth/access_token`;

const PAGE_INSIGHTS = [
  "page_media_view",
  "page_total_media_view_unique",
  "page_daily_follows_unique",
  "page_follows",
  "page_post_engagements",
] as const;

const POST_INSIGHTS = [
  "post_media_view",
  "post_total_media_view_unique",
  "post_clicks",
  "post_reactions_by_type_total",
] as const;

const POST_FIELDS = [
  "id",
  "message",
  "created_time",
  "permalink_url",
  "full_picture",
  "post_id",
  "shares",
  "comments.limit(0).summary(true)",
  "reactions.limit(0).summary(true)",
];

/// attached_media cap on a single feed post (album flow not implemented).
const MAX_ATTACHED_MEDIA = 10;
const VIDEO_URL_SUFFIXES = [".mp4", ".mov"];

@Injectable()
export class FacebookProvider implements SocialProvider {
  readonly platformName = "facebook" as const;
  readonly maxCaptionLength = 63_206;
  readonly supportedPostTypes: PostType[] = ["text", "image", "video"];
  readonly supportedMediaTypes: MediaType[] = ["image", "video"];
  readonly rateLimits = { maxPerWindow: 200, windowSeconds: 3600 };

  private clientId = process.env.PLATFORM_FACEBOOK_APP_ID ?? "";
  private clientSecret = process.env.PLATFORM_FACEBOOK_APP_SECRET ?? "";

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
        "pages_show_list",
        "pages_manage_posts",
        "pages_manage_engagement",
        "pages_read_engagement",
        "pages_read_user_content",
        "pages_manage_metadata",
        "read_insights",
        "pages_messaging",
        "business_management",
      ].join(","),
      response_type: "code",
    });
    return `${FACEBOOK_OAUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const data = await this.tokenRequest({
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    return {
      accessToken: String(data["access_token"]),
      expiresAt: expiresInToDate(data["expires_in"]),
      tokenType: String(data["token_type"] ?? "Bearer"),
    };
  }

  /// Facebook has no refresh tokens: exchange short-lived → long-lived (~60d).
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
      throw new MetaApiError("Facebook long-lived token exchange failed", response.status, body);
    }
    return {
      accessToken: String(body["access_token"]),
      expiresAt: expiresInToDate(body["expires_in"]),
      tokenType: String(body["token_type"] ?? "Bearer"),
    };
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const data = await graphGet(`${GRAPH_BASE_URL}/me`, accessToken, {
      fields: "id,name,picture",
    });
    const picture = data["picture"] as Record<string, unknown> | undefined;
    const inner = picture?.["data"] as Record<string, unknown> | undefined;
    return {
      platformAccountId: String(data["id"]),
      username: "",
      displayName: String(data["name"] ?? ""),
      avatarUrl: (inner?.["url"] as string | undefined) ?? null,
      meta: data,
    };
  }

  /// Pages the user manages — each becomes a connectable account with its own token.
  async getUserPages(accessToken: string): Promise<
    Array<{
      id: string;
      name: string;
      accessToken: string;
      category: string;
      picture: string | null;
      followersCount: number;
    }>
  > {
    const data = await graphGet(`${GRAPH_BASE_URL}/me/accounts`, accessToken, {
      fields: "id,name,access_token,category,picture,followers_count",
    });

    return (((data["data"] as Array<Record<string, unknown>>) ?? [])).map((page) => {
      const picture = page["picture"] as Record<string, unknown> | undefined;
      const inner = picture?.["data"] as Record<string, unknown> | undefined;
      return {
        id: String(page["id"]),
        name: String(page["name"] ?? ""),
        accessToken: String(page["access_token"] ?? ""),
        category: String(page["category"] ?? ""),
        picture: (inner?.["url"] as string | undefined) ?? null,
        followersCount: Number(page["followers_count"] ?? 0),
      };
    });
  }

  // ------------------------------------------------------------------
  // Publishing
  // ------------------------------------------------------------------

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    const pageId = content.extra?.["pageId"] as string | undefined;
    if (!pageId) {
      throw new Error("page_id is required in content.extra for Facebook publishing");
    }

    const postType = detectPostType(content);
    if (postType === "image" && content.media.length > 0) {
      return this.publishPhoto(accessToken, pageId, content);
    }
    if (postType === "video" && content.media.length > 0) {
      return this.publishVideo(accessToken, pageId, content);
    }
    return this.publishTextOrLink(accessToken, pageId, content);
  }

  private async publishTextOrLink(
    accessToken: string,
    pageId: string,
    content: PostContent,
  ): Promise<PublishResult> {
    const payload: Record<string, unknown> = { message: content.caption };
    if (content.extra?.["linkUrl"]) payload.link = content.extra["linkUrl"];

    const data = await graphPost(`${GRAPH_BASE_URL}/${pageId}/feed`, accessToken, payload);
    const graphPostId = String(data["id"]);
    return {
      platformPostId: storedPostId(graphPostId),
      permalink: `https://www.facebook.com/${graphPostId}`,
      publishedAt: new Date(),
    };
  }

  private async publishPhoto(
    accessToken: string,
    pageId: string,
    content: PostContent,
  ): Promise<PublishResult> {
    if (content.media.length > 1) {
      return this.publishMultiPhoto(accessToken, pageId, content);
    }

    const payload: Record<string, unknown> = { url: content.media[0]!.url };
    if (content.caption) payload.message = content.caption;

    const data = await graphPost(`${GRAPH_BASE_URL}/${pageId}/photos`, accessToken, payload);
    const graphPostId = String(data["post_id"] ?? data["id"]);
    return {
      platformPostId: storedPostId(graphPostId),
      permalink: `https://www.facebook.com/${graphPostId}`,
      publishedAt: new Date(),
    };
  }

  private async publishMultiPhoto(
    accessToken: string,
    pageId: string,
    content: PostContent,
  ): Promise<PublishResult> {
    const urls = content.media.map((m) => m.url);

    // Fail before any network call so we never leave orphaned staged photos.
    if (urls.length > MAX_ATTACHED_MEDIA) {
      throw new Error(
        `Facebook multi-photo posts support at most ${MAX_ATTACHED_MEDIA} photos (got ${urls.length})`,
      );
    }
    if (urls.some(isVideoUrl)) {
      throw new Error("Facebook multi-photo posts support images only; post videos separately");
    }

    const photoIds: string[] = [];
    try {
      for (const url of urls) {
        const data = await graphPost(`${GRAPH_BASE_URL}/${pageId}/photos`, accessToken, {
          url,
          published: false,
        });
        const photoId = data["id"] ? String(data["id"]) : "";
        if (!photoId) throw new Error("Failed to stage Facebook photo for multi-photo post");
        photoIds.push(photoId);
      }

      const payload: Record<string, unknown> = {
        attached_media: photoIds.map((mediaFbid) => ({ media_fbid: mediaFbid })),
      };
      if (content.caption) payload.message = content.caption;

      const data = await graphPost(`${GRAPH_BASE_URL}/${pageId}/feed`, accessToken, payload);
      const graphPostId = String(data["id"] ?? "");
      if (!graphPostId) throw new Error("Failed to publish Facebook multi-photo post");

      return {
        platformPostId: storedPostId(graphPostId),
        permalink: `https://www.facebook.com/${graphPostId}`,
        publishedAt: new Date(),
      };
    } catch (error) {
      // Best-effort cleanup so retries don't accumulate orphaned media.
      await this.deleteStagedPhotos(accessToken, photoIds);
      throw error;
    }
  }

  private async deleteStagedPhotos(accessToken: string, photoIds: string[]): Promise<void> {
    for (const photoId of photoIds) {
      try {
        const response = await fetch(`${GRAPH_BASE_URL}/${photoId}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${accessToken}` },
        });
        void response;
      } catch {
        // never masks the original publish failure (legacy parity)
      }
    }
  }

  private async publishVideo(
    accessToken: string,
    pageId: string,
    content: PostContent,
  ): Promise<PublishResult> {
    const payload: Record<string, unknown> = { file_url: content.media[0]!.url };
    if (content.caption) payload.description = content.caption;

    const data = await graphPost(`${GRAPH_BASE_URL}/${pageId}/videos`, accessToken, payload);
    const videoId = String(data["id"]);

    // Video processing is async — resolving the feed post id is best-effort.
    // Nothing here may propagate or the publisher would retry and double-post.
    let videoFields: Record<string, unknown> = {};
    try {
      videoFields = await graphGet(`${GRAPH_BASE_URL}/${videoId}`, accessToken, {
        fields: "post_id,permalink_url",
      });
    } catch {
      // fall back to bare video id (legacy parity)
    }

    const graphPostId = String(videoFields["post_id"] || videoId);
    const url =
      (videoFields["permalink_url"] as string | undefined) ??
      `https://www.facebook.com/${graphPostId}`;
    return {
      platformPostId: storedPostId(graphPostId),
      permalink: url,
      publishedAt: new Date(),
    };
  }

  // ------------------------------------------------------------------
  // Comments / inbox
  // ------------------------------------------------------------------

  async publishComment(
    accessToken: string,
    postId: string,
    text: string,
    options?: ProviderCallOptions,
  ) {
    const scopedId = pageScopedPostId(postId, options?.pageId);
    const data = await graphPost(`${GRAPH_BASE_URL}/${scopedId}/comments`, accessToken, {
      message: text,
    });
    return { platformCommentId: String(data["id"]) };
  }

  async getMessages(accessToken: string, since?: Date) {
    const pageId = "me"; // resolved from token scope
    const params = new URLSearchParams({ fields: "id,message,from,created_time" });
    if (since) params.set("since", String(Math.floor(since.getTime() / 1000)));

    const results: Array<{
      platformMessageId: string;
      senderPlatformId: string;
      senderName: string;
      body: string;
      receivedAt: Date;
      conversationId?: string;
    }> = [];

    const convosRes = await graphGet(
      `${GRAPH_BASE_URL}/${pageId}/conversations`,
      accessToken,
      Object.fromEntries(since ? [["since", String(Math.floor(since.getTime() / 1000))]] : []),
    );
    for (const convo of ((convosRes["data"] as Array<Record<string, unknown>>) ?? [])) {
      const convoId = String(convo["id"]);
      const msgsRes = await graphGet(`${GRAPH_BASE_URL}/${convoId}/messages`, accessToken, {
        fields: "id,message,from,created_time",
      });
      for (const msg of ((msgsRes["data"] as Array<Record<string, unknown>>) ?? [])) {
        const from = (msg["from"] ?? {}) as Record<string, unknown>;
        results.push({
          platformMessageId: String(msg["id"]),
          senderPlatformId: String(from["id"] ?? ""),
          senderName: String(from["name"] ?? ""),
          body: String(msg["message"] ?? ""),
          receivedAt: new Date(String(msg["created_time"])),
          conversationId: convoId,
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

  async getPostMetrics(accessToken: string, postId: string, options?: ProviderCallOptions) {
    const { fields, candidateIds } = await this.resolvePostFields(accessToken, postId, options?.pageId);
    const { values, insightPostId } = await this.getPostInsights(accessToken, candidateIds);

    const reactions = values["post_reactions_by_type_total"];
    const reactionsTotal =
      reactions && typeof reactions === "object"
        ? Object.values(reactions as Record<string, number>).reduce((a, b) => a + b, 0)
        : summaryTotal(fields, "reactions");

    return {
      reach: Number(values["post_total_media_view_unique"] ?? 0),
      likes: 0,
      comments: summaryTotal(fields, "comments"),
      shares: shareCount(fields),
      collectedAt: new Date(),
      meta: {
        clicks: values["post_clicks"] ?? 0,
        videoViews: values["post_media_view"] ?? 0,
        reactionsTotal,
        rawFields: fields,
        rawInsights: values,
        insightPostId,
        attemptedInsightPostIds: candidateIds,
      },
    };
  }

  private async resolvePostFields(
    accessToken: string,
    postId: string,
    pageId?: string,
  ): Promise<{ fields: Record<string, unknown>; candidateIds: string[] }> {
    const fields = await this.getPostFields(accessToken, postId);
    const candidates = [fields["post_id"], pageId && !postId.includes("_") ? `${pageId}_${postId}` : "", postId];
    const dedupedCandidates = [...new Set(candidates.filter(Boolean).map(String))];

    let bestFields = fields;
    for (const candidate of dedupedCandidates) {
      if (!candidate || candidate === postId) continue;
      const feedFields = await this.getPostFields(accessToken, candidate);
      if (Object.keys(feedFields).length > 0) {
        bestFields = { ...fields, ...feedFields };
        break;
      }
    }
    return { fields: bestFields, candidateIds: dedupedCandidates };
  }

  private async getPostInsights(accessToken: string, postIds: string[]) {
    const metric = POST_INSIGHTS.join(",");
    for (const postId of postIds) {
      try {
        const response = await graphGet(`${GRAPH_BASE_URL}/${postId}/insights`, accessToken, {
          metric,
        });
        return { values: parseInsightsResponse(response), errors: {}, insightPostId: postId };
      } catch (exc) {
        // try next candidate (legacy parity)
        void exc;
      }
    }
    return { values: {}, errors: {}, insightPostId: postIds[0] ?? "" };
  }

  /// Retries once without ``post_id`` when Graph rejects that Video-node field.
  private async getPostFields(
    accessToken: string,
    postId: string,
  ): Promise<Record<string, unknown>> {
    const fieldSets = [POST_FIELDS, POST_FIELDS.filter((f) => f !== "post_id")];
    for (const fields of fieldSets) {
      try {
        return await graphGet(`${GRAPH_BASE_URL}/${postId}`, accessToken, {
          fields: fields.join(","),
        });
      } catch (exc) {
        const message = exc instanceof Error ? exc.message : "";
        if (!message.includes("post_id")) break;
      }
    }
    return {};
  }

  async getAccountMetrics(
    accessToken: string,
    since: Date,
    until: Date,
    options?: ProviderCallOptions,
  ) {
    const pageId = options?.pageId ?? "me";
    const { values, errors } = await fetchInsightsSafe(graphGet, {
      endpoint: `${GRAPH_BASE_URL}/${pageId}/insights`,
      accessToken,
      metrics: PAGE_INSIGHTS,
      baseParams: {
        period: "day",
        since: String(Math.floor(since.getTime() / 1000)),
        until: String(Math.floor(until.getTime() / 1000)),
      },
    });

    let followers = 0;
    try {
      const page = await graphGet(`${GRAPH_BASE_URL}/${pageId}`, accessToken, {
        fields: "followers_count",
      });
      followers = Number(page["followers_count"] ?? 0);
    } catch {
      // legacy parity: fall through to insights value
    }
    if (!followers) followers = Number(values["page_follows"] ?? 0);

    return {
      followers,
      followerDelta: Number(values["page_daily_follows_unique"] ?? 0),
      impressions: null,
      reach: Number(values["page_total_media_view_unique"] ?? 0),
      collectedAt: new Date(),
      meta: {
        views: values["page_media_view"] ?? 0,
        rawInsights: values,
        insightErrors: errors,
      },
    };
  }

  async revokeToken(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch(`${GRAPH_BASE_URL}/me/permissions`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
    const search = new URLSearchParams(params);
    const response = await fetch(TOKEN_URL, { method: "POST" , headers: { }, body: search });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || !body["access_token"]) {
      throw new MetaApiError("Facebook token exchange failed", response.status, body);
    }
    return body;
  }

}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

/** Store only Facebook's post object id from PAGEID_POSTID values (legacy parity). */
export function storedPostId(graphPostId: string): string {
  const postId = String(graphPostId || "");
  if (postId.includes("_")) return postId.split("_").pop()!;
  return postId;
}

export function pageScopedPostId(postId: string, pageId?: string): string {
  if (postId.includes("_")) return postId;
  if (pageId && postId) return `${pageId}_${postId}`;
  return postId;
}

function isVideoUrl(url: string): boolean {
  // Path only, so presigned query strings don't defeat the check (legacy).
  const path = new URL(url).pathname.toLowerCase();
  return VIDEO_URL_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function summaryTotal(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const summary = (value as Record<string, unknown>)["summary"] as
      | Record<string, unknown>
      | undefined;
    return Number(summary?.["total_count"] ?? 0);
  }
  return 0;
}

function shareCount(data: Record<string, unknown>): number {
  const value = data["shares"];
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    return Number((value as Record<string, unknown>)["count"] ?? 0);
  }
  return 0;
}

function detectPostType(content: PostContent): PostType {
  if (content.media.length === 0) return "text";
  return content.media[0]!.type;
}

function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}
