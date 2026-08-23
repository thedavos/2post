import { createHash } from "node:crypto";
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
 * Port of providers/tiktok.py — Content Posting API v2.
 * PKCE, privacy validation and publish-handle→video-id resolution must
 * match the legacy Python provider.
 */

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const API_BASE = "https://open.tiktokapis.com/v2";

const DEFAULT_PRIVACY_LEVEL = "PUBLIC_TO_EVERYONE";
const VALID_PRIVACY_LEVELS = new Set([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);
const OPTIONAL_POST_INFO_FIELDS = ["disable_duet", "disable_comment", "disable_stitch"] as const;
/// The typo is part of TikTok's API contract.
const PUBLICLY_AVAILABLE_POST_ID_KEY = "publicaly_available_post_id";

export class PublishError extends Error {}
export class OAuthError extends Error {}

/** PKCE S256: BASE64URL(SHA256(verifier)) without padding (legacy parity). */
export function pkceCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

@Injectable()
export class TikTokProvider implements SocialProvider {
  readonly platformName = "tiktok" as const;
  readonly maxCaptionLength = 2200;
  readonly supportedPostTypes: PostType[] = ["video"];
  readonly supportedMediaTypes: MediaType[] = ["video"];
  readonly rateLimits = { maxPerWindow: 100, windowSeconds: 3600 };

  private clientKey = process.env.PLATFORM_TIKTOK_CLIENT_KEY ?? "";
  private clientSecret = process.env.PLATFORM_TIKTOK_CLIENT_SECRET ?? "";

  configure(credentials?: { clientKey?: string; clientSecret?: string }): this {
    if (credentials?.clientKey) this.clientKey = credentials.clientKey;
    if (credentials?.clientSecret) this.clientSecret = credentials.clientSecret;
    return this;
  }

  getAuthUrl(redirectUri: string, state: string, codeVerifier?: string): string {
    const params = new URLSearchParams({
      client_key: this.clientKey,
      redirect_uri: redirectUri,
      state,
      scope: ["user.info.basic", "video.publish", "video.upload", "video.list"].join(","),
      response_type: "code",
    });
    if (codeVerifier) {
      params.set("code_challenge", pkceCodeChallenge(codeVerifier));
      params.set("code_challenge_method", "S256");
    }
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<OAuthTokens> {
    const data: Record<string, string> = {
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    };
    if (codeVerifier) data.code_verifier = codeVerifier;

    const body = await postForm(TOKEN_URL, data);
    if (!body["access_token"]) throw new OAuthError(`TikTok token exchange failed: ${JSON.stringify(body).slice(0, 200)}`);
    return tokensFromBody(body);
  }

  async refreshToken(refreshTokenValue: string): Promise<OAuthTokens> {
    const body = await postForm(TOKEN_URL, {
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      refresh_token: refreshTokenValue,
      grant_type: "refresh_token",
    });
    if (!body["access_token"]) throw new OAuthError(`TikTok token refresh failed: ${JSON.stringify(body).slice(0, 200)}`);
    return tokensFromBody(body);
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const body = await authGetJson(`${API_BASE}/user/info/`, accessToken, {
      fields: "open_id,union_id,avatar_url,display_name",
    });
    const user = ((body["data"] as Record<string, unknown>)?.["user"] ?? {}) as Record<string, unknown>;
    return {
      platformAccountId: String(user["open_id"] ?? ""),
      username: "",
      displayName: String(user["display_name"] ?? ""),
      avatarUrl: (user["avatar_url"] as string | undefined) ?? null,
      followers: 0,
      meta: { union_id: user["union_id"] },
    };
  }

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    if (content.media[0]?.type !== "video") {
      throw new PublishError("TikTok only supports VIDEO posts");
    }

    const explicitPrivacy = content.extra?.["privacy_level"] !== undefined;
    const privacyLevel = String(content.extra?.["privacy_level"] ?? DEFAULT_PRIVACY_LEVEL);
    if (!VALID_PRIVACY_LEVELS.has(privacyLevel)) {
      throw new PublishError(`Invalid privacy_level '${privacyLevel}'. Must be one of ${[...VALID_PRIVACY_LEVELS].sort().join(",")}`);
    }
    void explicitPrivacy;

    // Creator constraints check is best-effort in the legacy provider; the
    // init call surfaces any real error, so we skip it here too.
    return this.publishPullFromUrl(accessToken, content, privacyLevel);
  }

  /// PULL_FROM_URL requires a domain verified with TikTok; presigned S3/R2
  /// URLs can't satisfy that, so self-hosters register their media domain.
  private async publishPullFromUrl(
    accessToken: string,
    content: PostContent,
    privacyLevel: string,
  ): Promise<PublishResult> {
    const payload = {
      post_info: this.buildPostInfo(content, privacyLevel),
      source_info: {
        source: "PULL_FROM_URL",
        video_url: content.media[0]!.url,
      },
    };

    const body = await this.initVideoPublish(accessToken, payload);
    const data = (body["data"] ?? {}) as Record<string, unknown>;
    const publishId = String(data["publish_id"] ?? "");
    return {
      platformPostId: publishId,
      permalink: null,
      publishedAt: new Date(),
      meta: { raw: data },
    };
  }

  private buildPostInfo(content: PostContent, privacyLevel: string): Record<string, unknown> {
    const extra = content.extra ?? {};
    const postInfo: Record<string, unknown> = {
      title: (content.title || content.caption || "").slice(0, this.maxCaptionLength),
      privacy_level: privacyLevel,
    };
    for (const field of OPTIONAL_POST_INFO_FIELDS) {
      if (field in extra) postInfo[field] = Boolean(extra[field]);
    }
    const coverMs = extra["video_cover_timestamp_ms"];
    if (coverMs !== undefined && coverMs !== null) {
      const parsed = Number(coverMs);
      if (Number.isFinite(parsed) && parsed >= 0) {
        postInfo.video_cover_timestamp_ms = parsed;
      }
    }
    return postInfo;
  }

  private async initVideoPublish(
    accessToken: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${API_BASE}/post/publish/video/init/`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      // Permanent codes must not be retried by the publisher engine.
      const error = (body["error"] as Record<string, unknown>) ?? {};
      const code = String(error["code"] ?? "");
      if (code === "unaudited_client_can_only_post_to_private_accounts") {
        throw new PublishError(
          "TikTok rejected the post: unaudited clients may only post to private accounts",
        );
      }
      throw new PublishError(`TikTok video init failed: HTTP ${response.status}`);
    }
    return body;
  }

  /** Numeric ids are final video IDs; otherwise resolve via status fetch. */
  async resolveVideoId(accessToken: string, postId: string): Promise<string | null> {
    if (!postId) return null;
    if (/^\d+$/.test(postId)) return postId;

    const statusData = await this.fetchPublishStatus(accessToken, postId);
    if (statusData["status"] !== "PUBLISH_COMPLETE") return null;
    const videoIds = statusData[PUBLICLY_AVAILABLE_POST_ID_KEY];
    if (typeof videoIds === "string") return videoIds || null;
    return Array.isArray(videoIds) ? (videoIds[0] as string) ?? null : null;
  }

  private async fetchPublishStatus(accessToken: string, publishId: string): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${API_BASE}/post/publish/status/fetch/`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      return ((body["data"] ?? {}) as Record<string, unknown>) || {};
    } catch {
      return {};
    }
  }

  getPostMetrics(): never {
    throw new Error("TikTok metrics land with the analytics phase (requires video.list scope)");
  }
  getAccountMetrics(): never {
    throw new Error("TikTok account metrics land with the analytics phase");
  }
  publishComment(): never {
    throw new Error("TikTok does not support comment publishing");
  }
}

function tokensFromBody(body: Record<string, unknown>): OAuthTokens {
  return {
    accessToken: String(body["access_token"]),
    refreshToken: body["refresh_token"] ? String(body["refresh_token"]) : undefined,
    expiresAt: expiresInToDate(body["expires_in"]),
    scope: body["scope"] ? String(body["scope"]) : undefined,
  };
}

function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

async function postForm(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return (await response.json()) as Record<string, unknown>;
}

async function authGetJson(
  url: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const search = new URLSearchParams(params);
  const response = await fetch(`${url}?${search.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return (await response.json()) as Record<string, unknown>;
}
