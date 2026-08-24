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
 * Port of providers/bluesky.py — AT Protocol session auth (app passwords).
 * Request shapes and facet byte-offset semantics must match the legacy
 * Python provider exactly.
 */

const DEFAULT_PDS_URL = "https://bsky.social";
const MAX_GRAPHEMES = 300;

export class PublishError extends Error {}

interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<Record<string, unknown>>;
}

/** Seconds until an AT Protocol access JWT expires (exp claim), or null. */
export function accessJwtExpiresIn(accessJwt: string): number | null {
  try {
    const payloadB64 = accessJwt.split(".")[1]!;
    const padding = "=".repeat(-(payloadB64.length % 4));
    const payload = JSON.parse(
      Buffer.from(payloadB64 + padding, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const exp = Number(payload["exp"]);
    if (!Number.isFinite(exp)) return null;
    return Math.max(0, exp - Math.floor(Date.now() / 1000));
  } catch {
    return null;
  }
}

@Injectable()
export class BlueskyProvider implements SocialProvider {
  readonly platformName = "bluesky" as const;
  readonly maxCaptionLength = MAX_GRAPHEMES;
  readonly supportedPostTypes: PostType[] = ["text", "image", "video"];
  readonly supportedMediaTypes: MediaType[] = ["image", "video"];
  readonly rateLimits = { maxPerWindow: 5000, windowSeconds: 3600 };

  private pdsUrl = DEFAULT_PDS_URL;

  /** Used by SocialAccountsModule at connect time (handle + app password). */
  configure(pdsUrl?: string): this {
    this.pdsUrl = (pdsUrl || DEFAULT_PDS_URL).replace(/\/+$/, "");
    return this;
  }

  getAuthUrl(): never {
    throw new Error("Bluesky uses session-based auth, not OAuth. Use create_session() instead.");
  }
  exchangeCode(): never {
    throw new Error("Bluesky uses session-based auth, not OAuth. Use create_session() instead.");
  }

  /** Resolve a handle to a DID — always via bsky.social (legacy parity). */
  async resolveHandle(handle: string): Promise<string> {
    const data = await this.getJson(
      `${DEFAULT_PDS_URL}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    );
    return data["did"] as string;
  }

  async createSession(handle: string, appPassword: string): Promise<OAuthTokens> {
    const data = await this.postJson(`${this.pdsUrl}/xrpc/com.atproto.server.createSession`, {
      identifier: handle,
      password: appPassword,
    });
    return {
      accessToken: data["accessJwt"] as string,
      refreshToken: data["refreshJwt"] as string,
      expiresAt: expiresToDate(accessJwtExpiresIn(data["accessJwt"] as string)),
    };
  }

  async refreshToken(refreshJwt: string): Promise<OAuthTokens> {
    const data = await this.postJson(
      `${this.pdsUrl}/xrpc/com.atproto.server.refreshSession`,
      undefined,
      refreshJwt,
    );
    return {
      accessToken: data["accessJwt"] as string,
      refreshToken: data["refreshJwt"] as string,
      expiresAt: expiresToDate(accessJwtExpiresIn(data["accessJwt"] as string)),
    };
  }

  async revokeToken(accessToken: string): Promise<boolean> {
    try {
      await this.postJson(`${this.pdsUrl}/xrpc/com.atproto.server.deleteSession`, undefined, accessToken);
      return true;
    } catch {
      return false;
    }
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const session = await this.getJson(
      `${this.pdsUrl}/xrpc/com.atproto.server.getSession`,
      accessToken,
    );
    const did = session["did"] as string;

    const data = await this.getJson(
      `${this.pdsUrl}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
      accessToken,
    );
    const handle = String(data.handle ?? "");
    return {
      platformAccountId: String(data.did ?? did),
      username: handle,
      displayName: String(data.displayName || handle),
      avatarUrl: (data.avatar as string | undefined) ?? null,
      followers: Number(data.followersCount ?? 0),
    };
  }

  async publishPost(accessToken: string, content: PostContent): Promise<PublishResult> {
    // Grapheme-ish length check (legacy uses Python len() = code points).
    const graphemeCount = [...content.caption].length;
    if (graphemeCount > MAX_GRAPHEMES) {
      throw new PublishError(`Post text exceeds ${MAX_GRAPHEMES} graphemes (got ${graphemeCount})`);
    }

    const session = await this.getJson(
      `${this.pdsUrl}/xrpc/com.atproto.server.getSession`,
      accessToken,
    );
    const did = session["did"] as string;

    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text: content.caption,
      createdAt: new Date().toISOString().replace("+00:00", "Z"),
    };

    const facets = await this.parseFacets(content.caption, accessToken);
    if (facets.length > 0) record.facets = facets;

    const embed = await this.buildEmbed(accessToken, content);
    if (embed) record.embed = embed;

    const data = await this.postJson(
      `${this.pdsUrl}/xrpc/com.atproto.repo.createRecord`,
      {
        repo: did,
        collection: "app.bsky.feed.post",
        record,
      },
      accessToken,
    );

    const uri = String(data.uri ?? "");
    const rkey = uri ? uri.split("/").pop()! : "";
    const handle = String(session.handle ?? "");
    const postUrl = rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : null;

    return { platformPostId: uri, permalink: postUrl, publishedAt: new Date() };
  }

  publishComment(): never {
    throw new Error("Bluesky reply support lands with the inbox phase");
  }

  /// AT Protocol exposes no per-post metrics API (legacy parity).
  getPostMetrics(): never {
    throw new Error("Bluesky does not expose post metrics");
  }

  getAccountMetrics(): never {
    throw new Error("Bluesky does not expose account metrics");
  }

  // ------------------------------------------------------------------
  // Rich text facets (links, mentions, hashtags) with UTF-8 byte offsets
  // ------------------------------------------------------------------

  private async parseFacets(text: string, accessToken: string): Promise<Facet[]> {
    const facets: Facet[] = [];
    const bytes = (s: string) => Buffer.byteLength(s, "utf8");

    for (const match of text.matchAll(/https?:\/\/[^\s\)\]>]+/g)) {
      facets.push({
        index: { byteStart: bytes(text.slice(0, match.index)), byteEnd: bytes(text.slice(0, match.index + match[0].length)) },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }],
      });
    }

    for (const match of text.matchAll(/(?<!\w)@([\w.-]+(?:\.[\w.-]+)+)/g)) {
      const startByte = bytes(text.slice(0, match.index));
      let did: string;
      try {
        did = await this.resolveHandle(match[1]!);
      } catch {
        continue; // unresolvable mention skipped (legacy parity)
      }
      facets.push({
        index: { byteStart: startByte, byteEnd: bytes(text.slice(0, match.index + match[0].length)) },
        features: [{ $type: "app.bsky.richtext.facet#mention", did }],
      });
    }

    for (const match of text.matchAll(/(?<!\w)#(\w+)/g)) {
      facets.push({
        index: { byteStart: bytes(text.slice(0, match.index)), byteEnd: bytes(text.slice(0, match.index + match[0].length)) },
        features: [{ $type: "app.bsky.richtext.facet#tag", tag: match[1] }],
      });
    }

    void accessToken;
    return facets;
  }

  // ------------------------------------------------------------------
  // Media embeds
  // ------------------------------------------------------------------

  private async buildEmbed(accessToken: string, content: PostContent): Promise<Record<string, unknown> | null> {
    if (content.media.length === 0) return null;

    const postType: PostType =
      content.media.some((m) => m.type === ("video" satisfies MediaType))
        ? "video"
        : content.media.length > 0 && content.media.every((m) => m.type === "image")
          ? "image"
          : "text";

    if (postType === "video") {
      const blobRef = await this.uploadBlobFromUrl(accessToken, content.media[0]!.url);
      return { $type: "app.bsky.embed.video", video: blobRef };
    }

    if (postType === "image") {
      const images = [];
      for (const media of content.media.slice(0, 4)) {
        const blobRef = await this.uploadBlobFromUrl(accessToken, media.url);
        images.push({ alt: media.altText ?? "", image: blobRef });
      }
      return { $type: "app.bsky.embed.images", images };
    }

    return null;
  }

  /// Legacy uploads local files; the new stack receives URLs (S3/media API),
  /// so we stream the bytes into the PDS upload endpoint.
  private async uploadBlobFromUrl(accessToken: string, url: string): Promise<unknown> {
    const fileResponse = await fetch(url);
    if (!fileResponse.ok) throw new PublishError(`Could not fetch media ${url}`);
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    const mimeType = fileResponse.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";

    const response = await fetch(`${this.pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "Content-Type": mimeType },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new PublishError(`uploadBlob failed with HTTP ${response.status}`);
    const data = (await response.json()) as Record<string, unknown>;
    return data.blob ?? data;
  }

  // ------------------------------------------------------------------
  // HTTP helpers
  // ------------------------------------------------------------------

  private async getJson(url: string, accessToken?: string): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
    if (!response.ok) throw new Error(`Bluesky request failed with HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }

  private async postJson(
    url: string,
    body?: unknown,
    accessToken?: string,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Bluesky request failed with HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }
}

function expiresToDate(seconds: number | null): Date | null {
  return seconds === null ? null : new Date(Date.now() + seconds * 1000);
}
