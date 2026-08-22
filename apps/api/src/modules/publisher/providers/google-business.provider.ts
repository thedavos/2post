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
 * Port of providers/google_business.py — Google Business Profile local posts.
 * Shares the Google OAuth client with YouTube (same PLATFORM_GOOGLE_* vars).
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const POSTS_API = "https://mybusiness.googleapis.com/v4";

export class PublishError extends Error {}
export class OAuthError extends Error {}

@Injectable()
export class GoogleBusinessProvider implements SocialProvider {
  readonly platformName = "google_business" as const;
  readonly maxCaptionLength = 1500;
  readonly supportedPostTypes: PostType[] = ["text", "image"];
  readonly supportedMediaTypes: MediaType[] = ["image"];
  readonly rateLimits = { maxPerWindow: 100, windowSeconds: 3600 };

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
      response_type: "code",
      scope: ["https://www.googleapis.com/auth/business.manage"].join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const data = await tokenForm({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    if ("error" in data) {
      throw new OAuthError(`Token exchange failed: ${data["error_description"] ?? data["error"]}`);
    }
    return googleTokens(data);
  }

  async refreshToken(refreshTokenValue: string): Promise<OAuthTokens> {
    const data = await tokenForm({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshTokenValue,
      grant_type: "refresh_token",
    });
    if ("error" in data) {
      throw new OAuthError(`Token refresh failed: ${data["error_description"] ?? data["error"]}`);
    }
    // Google doesn't rotate refresh tokens (legacy parity).
    return { ...googleTokens(data), refreshToken: refreshTokenValue };
  }

  async revokeToken(accessToken: string): Promise<boolean> {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(accessToken)}`, { method: "POST" });
      return true;
    } catch {
      return false;
    }
  }

  private async getAccountId(accessToken: string, explicit?: string): Promise<string> {
    if (explicit) return explicit;
    const data = await apiGetJson(`${ACCOUNTS_API}/accounts`, accessToken);
    const accounts = ((data["accounts"] as Array<Record<string, unknown>>) ?? []);
    if (accounts.length === 0) throw new PublishError("No Google Business accounts found");
    return String(accounts[0]!["name"]); // e.g. "accounts/123"
  }

  private async getLocationId(
    accessToken: string,
    accountId: string,
    explicit?: string,
  ): Promise<string> {
    if (explicit) return explicit;
    const data = await apiGetJson(`${BUSINESS_INFO_API}/${accountId}/locations`, accessToken);
    const locations = ((data["locations"] as Array<Record<string, unknown>>) ?? []);
    if (locations.length === 0) throw new PublishError("No locations found for Google Business account");
    return String(locations[0]!["name"]);
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const accountId = await this.getAccountId(accessToken);
    const data = await apiGetJson(`${BUSINESS_INFO_API}/${accountId}/locations`, accessToken);
    const locations = ((data["locations"] as Array<Record<string, unknown>>) ?? []);

    if (locations.length > 0) {
      const loc = locations[0]!;
      const addressObj = (loc["storefrontAddress"] ?? {}) as Record<string, unknown>;
      const addressLines = ((addressObj["addressLines"] as Array<string>) ?? []);
      const phoneNumbers = (loc["phoneNumbers"] ?? {}) as Record<string, unknown>;
      return {
        platformAccountId: String(loc["name"] ?? accountId),
        username: "",
        displayName: String(loc["title"] || loc["name"] || ""),
        meta: {
          address: addressLines.join(", "),
          phone: String(phoneNumbers["primaryPhone"] ?? ""),
        },
      };
    }

    return { platformAccountId: accountId, username: "", displayName: accountId };
  }

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    if (content.caption.length > this.maxCaptionLength) {
      throw new PublishError(
        `Post text exceeds ${this.maxCaptionLength} characters (got ${content.caption.length})`,
      );
    }

    const extra = content.extra ?? {};
    const locationId = await this.getLocationId(
      accessToken,
      await this.getAccountId(accessToken, extra["accountId"] as string | undefined),
      extra["locationId"] as string | undefined,
    );

    const topicType = String(extra["topic_type"] ?? "STANDARD");
    const body: Record<string, unknown> = {
      languageCode: String(extra["language_code"] ?? "en"),
      summary: content.caption,
      topicType,
    };

    if (content.media.length > 0) {
      body["media"] = content.media.map((m) => ({ mediaFormat: "PHOTO", sourceUrl: m.url }));
    }
    if (topicType === "EVENT" && extra["event"]) body["event"] = extra["event"];
    if (topicType === "OFFER" && extra["offer"]) body["offer"] = extra["offer"];

    const data = await apiPostJson(`${POSTS_API}/${locationId}/localPosts`, accessToken, body);

    return {
      platformPostId: String(data["name"] ?? ""),
      permalink: (data["searchUrl"] as string | undefined) ?? null,
      publishedAt: new Date(),
      meta: { raw: data },
    };
  }

  publishComment(): never {
    throw new Error("Google Business does not support comment publishing");
  }

  async getPostMetrics(accessToken: string, postId: string) {
    const data = await apiGetJson(`${POSTS_API}/${postId}`, accessToken);
    let searchViews = 0;
    for (const metric of ((data["searchActionMetrics"] as Array<Record<string, unknown>>) ?? [])) {
      if (metric["metricType"] === "QUERIES_DIRECT") {
        searchViews += Number(metric["value"] ?? 0);
      }
    }
    return {
      impressions: searchViews,
      likes: null,
      comments: null,
      shares: null,
      collectedAt: new Date(),
      meta: {
        search_views: searchViews,
        maps_views: 0,
        raw: data,
      },
    };
  }

  getAccountMetrics(): never {
    throw new Error("Google Business account insights land with the analytics phase");
  }
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function googleTokens(data: Record<string, unknown>): OAuthTokens {
  return {
    accessToken: String(data["access_token"]),
    refreshToken: data["refresh_token"] ? String(data["refresh_token"]) : undefined,
    expiresAt: expiresInToDate(data["expires_in"]),
    tokenType: String(data["token_type"] ?? "Bearer"),
    scope: data["scope"] ? String(data["scope"]) : undefined,
  };
}

function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

async function tokenForm(params: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
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
