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
 * Port of providers/youtube.py — YouTube Data API v3 + resumable uploads.
 * Request shapes must match the legacy Python provider.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";
const ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2";

export class PublishError extends Error {}
export class OAuthError extends Error {}

@Injectable()
export class YouTubeProvider implements SocialProvider {
  readonly platformName = "youtube" as const;
  readonly maxCaptionLength = 5000;
  readonly supportedPostTypes: PostType[] = ["video"];
  readonly supportedMediaTypes: MediaType[] = ["video"];
  readonly rateLimits = { maxPerWindow: 10_000, windowSeconds: 86_400 };

  private clientId = process.env.PLATFORM_GOOGLE_CLIENT_ID ?? "";
  private clientSecret = process.env.PLATFORM_GOOGLE_CLIENT_SECRET ?? "";

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
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.force-ssl",
        "https://www.googleapis.com/auth/yt-analytics.readonly",
      ].join(" "),
      response_type: "code",
      access_type: "offline", // refresh token only issued on first consent
      prompt: "consent",
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    return this.tokenForm({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }, "YouTube token exchange failed");
  }

  async refreshToken(refreshTokenValue: string): Promise<OAuthTokens> {
    const tokens = await this.tokenForm({
      refresh_token: refreshTokenValue,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
    }, "YouTube token refresh failed");
    // Google may omit the refresh token on refresh — keep the existing one.
    if (!tokens.refreshToken) tokens.refreshToken = refreshTokenValue;
    return tokens;
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const body = await apiGet(`${API_BASE}/channels`, accessToken, {
      part: "snippet,statistics",
      mine: "true",
    });
    const items = ((body["items"] as Array<Record<string, unknown>>) ?? []);
    if (items.length === 0) {
      return { platformAccountId: "", username: "", displayName: "Unknown" };
    }

    const channel = items[0]!;
    const snippet = (channel["snippet"] ?? {}) as Record<string, unknown>;
    const stats = (channel["statistics"] ?? {}) as Record<string, unknown>;
    const thumbnails = (snippet["thumbnails"] ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const avatar =
      ((thumbnails["default"]?.["url"] as string | undefined) ??
        (thumbnails["medium"]?.["url"] as string | undefined)) ??
      null;

    return {
      platformAccountId: String(channel["id"]),
      username: String(snippet["customUrl"] ?? ""),
      displayName: String(snippet["title"] ?? ""),
      avatarUrl: avatar,
      followers: Number(stats["subscriberCount"] ?? 0),
      meta: {
        view_count: Number(stats["viewCount"] ?? 0),
        video_count: Number(stats["videoCount"] ?? 0),
      },
    };
  }

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    const firstUrl = content.media[0]?.url ?? "";
    const isVideo =
      content.media.length > 0 &&
      /\.(mp4|mov|avi|webm)(\?|$)/i.test(firstUrl);
    if (!isVideo) {
      throw new PublishError("YouTube only supports VIDEO posts");
    }

    let title = content.title || content.caption || "";
    const description = content.extra?.["description"]
      ? String(content.extra["description"])
      : content.caption;

    // Shorts: append #Shorts when requested and missing (legacy parity).
    if (content.extra?.["shorts"] === true && !title.includes("#Shorts")) {
      title = `${title} #Shorts`.trim();
    }

    const metadata = {
      snippet: {
        title: title.slice(0, 100),
        description: (description ?? "").slice(0, this.maxCaptionLength),
        tags: Array.isArray(content.extra?.["tags"]) ? content.extra!["tags"] : [],
        categoryId: String(content.extra?.["category_id"] ?? "22"), // People & Blogs
      },
      status: {
        privacyStatus: String(content.extra?.["privacy_status"] ?? "public"),
        selfDeclaredMadeForKids: Boolean(content.extra?.["self_declared_made_for_kids"]),
      },
    };

    // Step 1: initiate resumable upload
    const initResponse = await fetch(
      `${UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(metadata),
      },
    );
    const uploadUri = initResponse.headers.get("Location");
    if (!uploadUri) throw new PublishError("YouTube did not return a resumable upload URI");

    // Step 2: PUT the video bytes (streamed from the media URL in the new stack)
    const videoData = await fetchBytes(firstUrl);
    const uploadResponse = await fetch(uploadUri, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "video/*",
        "content-length": String(videoData.byteLength),
      },
      body: new Uint8Array(videoData),
    });
    const uploadBody = (await uploadResponse.json()) as Record<string, unknown>;
    if (!uploadResponse.ok) throw new PublishError(`YouTube video upload failed: HTTP ${uploadResponse.status}`);

    const videoId = String(uploadBody["id"] ?? "");

    // Step 3 (optional, best-effort): custom thumbnail
    const thumbnailUrl = content.extra?.["thumbnail_url"] as string | undefined;
    if (videoId && thumbnailUrl) {
      try {
        await uploadThumbnail(accessToken, videoId, thumbnailUrl);
      } catch {
        // never fails the publish (legacy parity)
      }
    }

    return {
      platformPostId: videoId,
      permalink: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
      publishedAt: new Date(),
      meta: { raw: uploadBody },
    };
  }

  async publishComment(accessToken: string, postId: string, text: string) {
    const body = await apiPostJson(`${API_BASE}/commentThreads?part=snippet`, accessToken, {
      snippet: {
        videoId: postId,
        topLevelComment: { snippet: { textOriginal: text } },
      },
    });
    return { platformCommentId: String(body["id"] ?? "") };
  }

  getMessages(): never {
    throw new Error("Inbox sync lands with the inbox phase");
  }
  replyToMessage(): never {
    throw new Error("Inbox sync lands with the inbox phase");
  }

  /// Data API counts only; watch time / avg view % live on the Analytics API.
  async getPostMetrics(accessToken: string, postId: string) {
    const body = await apiGet(`${API_BASE}/videos`, accessToken, {
      part: "statistics",
      id: postId,
    });
    const items = ((body["items"] as Array<Record<string, unknown>>) ?? []);
    if (items.length === 0) {
      return { impressions: 0, likes: 0, comments: 0, shares: 0, collectedAt: new Date(), meta: {} };
    }
    const stats = (items[0]!["statistics"] ?? {}) as Record<string, number | string>;
    const views = Number(stats["viewCount"] ?? 0);
    const likes = Number(stats["likeCount"] ?? 0);
    const comments = Number(stats["commentCount"] ?? 0);
    return {
      impressions: views,
      likes,
      comments,
      shares: 0, // no shareCount field on videos.list (legacy parity)
      collectedAt: new Date(),
      meta: {
        favorite_count: Number(stats["favoriteCount"] ?? 0),
        engagements: likes + comments,
      },
    };
  }

  /// Channel metrics from the Analytics API (1–2 day lag, single-day ranges).
  async getAccountMetrics(accessToken: string, since: Date, until: Date) {
    const body = await apiGet(`${ANALYTICS_BASE}/reports`, accessToken, {
      ids: "channel==MINE",
      startDate: since.toISOString().slice(0, 10),
      endDate: until.toISOString().slice(0, 10),
      metrics:
        "estimatedMinutesWatched,averageViewPercentage,subscribersGained,shares",
    });
    const headers = ((body["columnHeaders"] as Array<Record<string, unknown>>) ?? []);
    const rows = ((body["rows"] as Array<Array<unknown>>) ?? []);
    if (rows.length === 0 || !rows[0]) {
      return {
        followers: null,
        followerDelta: null,
        impressions: null,
        reach: null,
        collectedAt: new Date(),
        meta: {},
      };
    }

    const index = new Map(headers.map((col, i) => [String(col["name"]), i]));
    const row = rows[0]!;
    const num = (name: string) => Number(row[index.get(name) as number] ?? 0);

    return {
      followers: null,
      followerDelta: num("subscribersGained"),
      impressions: null,
      reach: null,
      collectedAt: new Date(),
      meta: {
        estimated_minutes_watched: num("estimatedMinutesWatched"),
        average_view_percentage: num("averageViewPercentage"),
        shares: num("shares"),
      },
    };
  }

  async revokeToken(): Promise<boolean> {
    // Google revocation handled via oauth2.googleapis.com/revoke (unused path).
    throw new Error("YouTube revoke lands with SocialAccountsModule");
  }

  private async tokenForm(params: Record<string, string>, failureMessage: string): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || !body["access_token"]) throw new OAuthError(failureMessage);
    return {
      accessToken: String(body["access_token"]),
      refreshToken: body["refresh_token"] ? String(body["refresh_token"]) : undefined,
      expiresAt: expiresInToDate(body["expires_in"]),
      scope: body["scope"] ? String(body["scope"]) : undefined,
    };
  }
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

async function apiGet(url: string, accessToken: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const search = new URLSearchParams(params);
  const response = await fetch(`${url}?${search.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
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

async function uploadThumbnail(accessToken: string, videoId: string, imageUrl: string): Promise<void> {
  const imageBytes = await fetchBytes(imageUrl);
  const contentType = imageUrl.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  await fetch(`${UPLOAD_BASE}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": contentType,
      "content-length": String(imageBytes.byteLength),
    },
    body: new Uint8Array(imageBytes),
  });
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new PublishError(`Could not fetch media ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}
