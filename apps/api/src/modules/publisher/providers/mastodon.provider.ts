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
 * Port of providers/mastodon.py — per-instance OAuth with automatic app
 * registration. Request shapes must match the legacy Python provider.
 */

const DEFAULT_MAX_CHARS = 500;
const SCOPES = "read write follow";

export class PublishError extends Error {}
export class OAuthError extends Error {}

@Injectable()
export class MastodonProvider implements SocialProvider {
  readonly platformName = "mastodon" as const;
  readonly maxCaptionLength = DEFAULT_MAX_CHARS; // refined via getInstanceMaxChars
  readonly supportedPostTypes = ["text", "image", "video"] as PostType[];
  readonly supportedMediaTypes: MediaType[] = ["image", "video"];
  readonly rateLimits = { maxPerWindow: 100, windowSeconds: 3600 };

  private instanceUrl = "";
  private clientId = process.env.PLATFORM_MASTODON_CLIENT_ID ?? "";
  private clientSecret = process.env.PLATFORM_MASTODON_CLIENT_SECRET ?? "";

  /** Called by SocialAccountsModule when connecting an arbitrary instance. */
  configure(instanceUrl: string, credentials?: { clientId?: string; clientSecret?: string }): this {
    this.instanceUrl = instanceUrl.replace(/\/+$/, "");
    if (credentials) {
      this.clientId = credentials.clientId ?? this.clientId;
      this.clientSecret = credentials.clientSecret ?? this.clientSecret;
    }
    return this;
  }

  /** Register the Brightbean app on an instance (once per instance). */
  async registerApp(
    instanceUrl: string,
    redirectUri: string,
  ): Promise<{ clientId: string; clientSecret: string; instanceUrl: string }> {
    const data = await postForm(`${instanceUrl.replace(/\/+$/, "")}/api/v1/apps`, {
      client_name: "Brightbean",
      redirect_uris: redirectUri,
      scopes: SCOPES,
      website: "https://brightbean.xyz",
    });
    return {
      clientId: String(data["client_id"]),
      clientSecret: String(data["client_secret"]),
      instanceUrl,
    };
  }

  getAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      response_type: "code",
      state,
    });
    return `${this.instanceUrl}/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const data = await postForm(`${this.instanceUrl}/oauth/token`, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: SCOPES,
    });

    if ("error" in data) {
      throw new OAuthError(`Token exchange failed: ${data["error_description"] ?? data["error"]}`);
    }
    return {
      accessToken: String(data["access_token"]),
      tokenType: String(data["token_type"] ?? "Bearer"),
      scope: data["scope"] ? String(data["scope"]) : undefined,
    };
  }

  /// Mastodon tokens do not expire by default — return as-is (legacy parity).
  refreshToken(refreshToken: string): Promise<OAuthTokens> {
    return Promise.resolve({ accessToken: refreshToken });
  }

  async revokeToken(accessToken: string): Promise<boolean> {
    try {
      await postForm(`${this.instanceUrl}/oauth/revoke`, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        token: accessToken,
      });
      return true;
    } catch {
      return false;
    }
  }

  async getInstanceMaxChars(accessToken: string): Promise<number> {
    try {
      const data = await getJson(`${this.instanceUrl}/api/v2/instance`, accessToken);
      const config = data["configuration"] as Record<string, unknown> | undefined;
      const statuses = config?.["statuses"] as Record<string, unknown> | undefined;
      return Number(statuses?.["max_characters"] ?? DEFAULT_MAX_CHARS);
    } catch {
      return DEFAULT_MAX_CHARS;
    }
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const data = await getJson(`${this.instanceUrl}/api/v1/accounts/verify_credentials`, accessToken);
    return {
      platformAccountId: String(data["id"]),
      username: String(data["acct"] ?? ""),
      displayName: String(data["display_name"] || data["username"] || ""),
      avatarUrl: (data["avatar"] as string | undefined) ?? null,
      followers: Number(data["followers_count"] ?? 0),
      meta: { username: data["username"] },
    };
  }

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    // Upload media first (legacy parity), then create the status.
    const mediaIds: string[] = [];
    for (const media of content.media.slice(0, 4)) {
      mediaIds.push(await this.uploadMediaFromUrl(accessToken, media.url));
    }

    const params: Record<string, string | string[]> = {};
    if (content.caption) params.status = content.caption;
    if (mediaIds.length > 0) params["media_ids[]"] = mediaIds;

    const extra = content.extra ?? {};
    params.visibility = String(extra["visibility"] ?? "public");
    if (extra["spoiler_text"]) params.spoiler_text = String(extra["spoiler_text"]);
    if (extra["in_reply_to_id"]) params.in_reply_to_id = String(extra["in_reply_to_id"]);

    const data = await postFormAuth(
      `${this.instanceUrl}/api/v1/statuses`,
      params,
      accessToken,
    );

    return {
      platformPostId: String(data["id"]),
      permalink: (data["url"] as string) ?? null,
      publishedAt: new Date(),
    };
  }

  async publishComment(accessToken: string, postId: string, text: string) {
    const data = await postFormAuth(
      `${this.instanceUrl}/api/v1/statuses`,
      { status: text, in_reply_to_id: postId, visibility: "public" },
      accessToken,
    );
    return { platformCommentId: String(data["id"]) };
  }

  /// Port of get_post_metrics: favourites/reblogs/replies.
  async getPostMetrics(accessToken: string, postId: string) {
    const data = await getJson(`${this.instanceUrl}/api/v1/statuses/${postId}`, accessToken);
    const likes = Number(data["favourites_count"] ?? 0);
    const shares = Number(data["reblogs_count"] ?? 0);
    const comments = Number(data["replies_count"] ?? 0);
    return {
      likes,
      shares,
      comments,
      collectedAt: new Date(),
      meta: { engagements: likes + shares + comments },
    };
  }

  async getMessages(accessToken: string) {
    const search = new URLSearchParams({ "types[]": "mention,favourite,reblog" });
    const data = await getJson(`${this.instanceUrl}/api/v1/notifications?${search.toString()}`, accessToken);

    const results: Array<{
      platformMessageId: string; senderPlatformId: string; senderName: string;
      body: string; receivedAt: Date;
    }> = [];
    for (const notif of ((data as unknown as Array<Record<string, unknown>>) ?? [])) {
      const status = notif["status"] as Record<string, unknown> | undefined;
      let text = String(status?.["content"] ?? "");
      text = text.replace(/<[^>]+>/g, ""); // strip HTML
      results.push({
        platformMessageId: String(notif["id"]),
        senderPlatformId: String((notif["account"] as Record<string,unknown>)?.["id"] ?? ""),
        senderName: String((notif["account"] as Record<string,unknown>)?.["display_name"] ?? ""),
        body: text,
        receivedAt: new Date(String(notif["created_at"])),
      });
    }
    return results;
  }

  async replyToMessage(accessToken: string, messageId: string, text: string) {
    const notif = await getJson(`${this.instanceUrl}/api/v1/notifications/${messageId}`, accessToken);
    const status = notif["status"] as Record<string, unknown> | undefined;
    const statusId = status?.["id"] ? String(status["id"]) : null;
    if (!statusId) throw new Error("Cannot reply: notification has no associated status");
    const result = await postFormAuth(`${this.instanceUrl}/api/v1/statuses`, {
      status: text,
      in_reply_to_id: statusId,
      visibility: "public",
    }, accessToken);
    return { platformReplyId: String(result["id"]) };
  }

  getAccountMetrics(): never {
    throw new Error("Mastodon does not expose follower-growth account metrics");
  }

  private async uploadMediaFromUrl(accessToken: string, url: string): Promise<string> {
    const fileResponse = await fetch(url);
    if (!fileResponse.ok) throw new PublishError(`Could not fetch media ${url}`);
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    const mimeType =
      fileResponse.headers.get("content-type")?.split(";")[0] || "application/octet-stream";

    const response = await fetch(`${this.instanceUrl}/api/v2/media`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": mimeType ?? "application/octet-stream",
      },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new PublishError(`media upload failed with HTTP ${response.status}`);
    const data = (await response.json()) as Record<string, unknown>;
    return String(data["id"]);
  }
}

// ---------------------------------------------------------------------
// form-encoded HTTP helpers (Mastodon expects application/x-www-form-urlencoded)
// ---------------------------------------------------------------------

async function toForm(params: Record<string, string | string[]>): Promise<URLSearchParams> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const v of value) search.append(key, v);
    else search.append(key, value);
  }
  return search;
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Mastodon request failed with HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  return requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: await toForm(params),
  });
}

async function postFormAuth(
  url: string,
  params: Record<string, string | string[]>,
  accessToken: string,
): Promise<Record<string, unknown>> {
  return requestJson(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: await toForm(params),
  });
}

async function getJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
  return requestJson(url, { headers: { authorization: `Bearer ${accessToken}` } });
}
