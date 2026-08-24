import { Injectable } from "@nestjs/common";

import type {
  AccountProfile,
  MediaType,
  PostContent,
  PostType,
  PublishResult,
  SocialProvider,
} from "@brightbean/shared";

/**
 * Port of providers/devto.py — DEV.to (Forem) via personal API key
 * (stored as the account's access token; no OAuth).
 * Request shapes must match the legacy Python provider exactly.
 */

const API_BASE = "https://dev.to/api";
const API_ACCEPT = "application/vnd.forem.api-v1+json";
const MAX_TAGS = 4;
const MAX_TITLE_LENGTH = 128;

export class PublishError extends Error {}

@Injectable()
export class DevtoProvider implements SocialProvider {
  readonly platformName = "devto" as const;
  readonly maxCaptionLength = 25_000;
  readonly supportedPostTypes: PostType[] = ["article", "text", "link"];
  readonly supportedMediaTypes: MediaType[] = ["image"];
  readonly rateLimits = { maxPerWindow: 1000, windowSeconds: 3600 };

  // API-key auth: OAuth flows are not applicable (legacy raises NotImplementedError).
  getAuthUrl(): string {
    throw new Error("DEV.to uses an API key, not OAuth. Use connect_devto instead.");
  }
  exchangeCode(): never {
    throw new Error("DEV.to uses an API key, not OAuth. Use connect_devto instead.");
  }
  refreshToken(): never {
    throw new Error("DEV.to uses an API key, not OAuth. Use connect_devto instead.");
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const data = await this.request(`${API_BASE}/users/me`, accessToken);

    return {
      platformAccountId: String(data.id ?? data.username ?? ""),
      username: String(data.username ?? ""),
      displayName: String(data.name || data.username || ""),
      avatarUrl: (data.profile_image_90 ?? data.profile_image ?? null) as string | null,
      followers: 0, // not exposed by /users/me (legacy parity)
      meta: data,
    };
  }

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    const title = (content.title ?? "").trim();
    if (!title) {
      throw new PublishError(
        "DEV.to requires a title. Set the post title before publishing.",
      );
    }

    const article: Record<string, unknown> = {
      title: title.slice(0, MAX_TITLE_LENGTH),
      body_markdown: content.caption,
      published: true,
    };

    const tags = extractTags(content);
    if (tags.length > 0) article.tags = tags;

    if (content.extra?.["linkUrl"]) article.canonical_url = content.extra["linkUrl"];

    const mainImage = firstImageUrl(content);
    if (mainImage) article.main_image = mainImage;

    const response = await fetch(`${API_BASE}/articles`, {
      method: "POST",
      headers: this.authHeaders(accessToken),
      body: JSON.stringify({ article }),
    });

    if (!response.ok) {
      throw new PublishError(`DEV.to publish failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (!data.id) {
      throw new PublishError(`DEV.to article creation returned no id: ${JSON.stringify(data).slice(0, 300)}`);
    }

    return {
      platformPostId: String(data.id),
      permalink: (data.url as string) ?? null,
      publishedAt: new Date(),
    };
  }

  publishComment(): never {
    throw new Error("DEV.to does not support comment publishing");
  }

  getPostMetrics(): never {
    throw new Error("DEV.to does not expose post metrics");
  }

  getAccountMetrics(): never {
    throw new Error("DEV.to does not expose account metrics");
  }

  private authHeaders(accessToken: string): Record<string, string> {
    // DEV.to authenticates with the ``api-key`` header, not Bearer (legacy parity).
    return {
      "api-key": accessToken,
      accept: API_ACCEPT,
      "content-type": "application/json",
    };
  }

  private async request(url: string, accessToken: string): Promise<Record<string, unknown>> {
    const response = await fetch(url, { headers: this.authHeaders(accessToken) });
    if (!response.ok) throw new PublishError(`DEV.to request failed with HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }
}

/** Resolve up to 4 Forem-valid tags from explicit hint or #hashtags (legacy parity). */
export function extractTags(content: PostContent): string[] {
  const raw =
    Array.isArray(content.extra?.tags) && content.extra!.tags.length > 0
      ? content.extra!.tags
      : (content.caption.match(/(?<!\w)#(\w+)/g) ?? []).map((t) => t.slice(1));

  const tags: string[] = [];
  for (const tag of raw) {
    const clean = String(tag)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (clean && !tags.includes(clean)) tags.push(clean);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function firstImageUrl(content: PostContent): string | null {
  for (const media of content.media) {
    const path = media.url.split("?")[0]!.toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp)$/.test(path)) return media.url;
  }
  return null;
}
