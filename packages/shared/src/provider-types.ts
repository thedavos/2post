/**
 * Port of providers/types.py + base.py — the SocialProvider contract.
 * Implementations live in apps/api/src/modules/social-accounts/providers/.
 * Request/response shapes must match the legacy Python providers exactly.
 */

export type PlatformSlug =
  | "facebook"
  | "instagram"
  | "instagram_login"
  | "linkedin_personal"
  | "linkedin_company"
  | "tiktok"
  | "youtube"
  | "google_business"
  | "pinterest"
  | "threads"
  | "bluesky"
  | "mastodon"
  | "devto";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  tokenType?: string;
  scope?: string;
}

export type PostType = "text" | "image" | "video" | "carousel" | "article" | "link";

export type MediaType = "image" | "video";

export interface RateLimitConfig {
  /** Max publishes per window */
  maxPerWindow: number;
  /** Window length in seconds */
  windowSeconds: number;
}

export interface AccountProfile {
  platformAccountId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  followers?: number | null;
  meta?: Record<string, unknown>;
}

export interface PostContent {
  caption: string;
  title?: string;
  media: Array<{ url: string; type: MediaType; altText?: string }>;
  firstComment?: string;
  scheduledFor?: Date;
  /** Per-platform extras (tags, canonical URL, privacy, …). */
  extra?: Record<string, unknown>;
}

export interface PublishResult {
  platformPostId: string;
  permalink?: string | null;
  publishedAt: Date;
}

export interface CommentResult {
  platformCommentId: string;
}

export interface PostMetrics {
  impressions?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  views?: number | null;
  watchTimeMs?: number | null;
  collectedAt: Date;
}

export interface AccountMetrics {
  followers: number | null;
  followerDelta: number | null;
  impressions: number | null;
  reach: number | null;
  collectedAt: Date;
}

export interface InboxMessage {
  platformMessageId: string;
  threadId?: string | null;
  kind: "comment" | "mention" | "dm" | "review";
  text: string;
  authorPlatformId: string;
  authorUsername?: string | null;
  createdAt: Date;
  permalink?: string | null;
}

export interface ReplyResult {
  platformReplyId: string;
}

/**
 * Abstract provider interface — mirrors providers/base.py SocialProvider.
 */
export interface SocialProvider {
  readonly platformName: PlatformSlug;
  readonly maxCaptionLength: number;
  readonly supportedPostTypes: PostType[];
  readonly supportedMediaTypes: MediaType[];
  readonly rateLimits: RateLimitConfig;

  getAuthUrl(redirectUri: string, state: string): Promise<string> | string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refreshToken(refreshToken: string): Promise<OAuthTokens>;
  getProfile(accessToken: string): Promise<AccountProfile>;
  publishPost(accessToken: string, content: PostContent): Promise<PublishResult>;
  publishComment(
    accessToken: string,
    postId: string,
    text: string,
    options?: ProviderCallOptions,
  ): Promise<CommentResult>;
  getPostMetrics(
    accessToken: string,
    postId: string,
    options?: ProviderCallOptions,
  ): Promise<PostMetrics>;
  getAccountMetrics(
    accessToken: string,
    since: Date,
    until: Date,
    options?: ProviderCallOptions,
  ): Promise<AccountMetrics>;
}

/** Per-call context (e.g. Facebook page_id / Instagram user id). */
export interface ProviderCallOptions {
  pageId?: string;
  igUserId?: string;
}
