/**
 * Port of apps/composer/status.py + PlatformPost.VALID_TRANSITIONS.
 * Pure functions so API, worker and frontend share one source of truth.
 */

export const PLATFORM_POST_STATUSES = [
  "draft",
  "pending_review",
  "pending_client",
  "approved",
  "changes_requested",
  "rejected",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "on_hold",
] as const;

export type PlatformPostStatus = (typeof PLATFORM_POST_STATUSES)[number];

/** Canonical workflow order from least- to most-advanced ("lower" wins). */
const WORKFLOW_ORDER: readonly string[] = [
  "draft",
  "changes_requested",
  "rejected",
  // Client-requested hold is action-required → ranks low on purpose.
  "on_hold",
  "pending_review",
  "pending_client",
  "approved",
  "scheduled",
  "publishing",
  "partially_published",
  "published",
];

const TERMINAL = new Set(["published", "failed"]);

/// Parity with legacy derive_post_status.
export function derivePostStatus(statuses: readonly string[]): string {
  const values = statuses.filter(Boolean);
  if (values.length === 0) return "draft";

  const unique = new Set(values);
  if (unique.size === 1) return values[0]!;

  if (values.every((s) => TERMINAL.has(s))) {
    if (unique.has("published") && unique.has("failed")) return "partially_published";
    return unique.has("published") ? "published" : "failed";
  }

  if (unique.has("failed")) return "publishing";

  let lowest = values[0]!;
  for (const status of values) {
    if (WORKFLOW_ORDER.indexOf(status) < WORKFLOW_ORDER.indexOf(lowest)) {
      lowest = status;
    }
  }
  return lowest;
}

export type PostStatus =
  | (typeof PLATFORM_POST_STATUSES)[number]
  | "partially_published";

/**
 * Valid state transitions (from → allowed targets). Parity with
 * legacy PlatformPost.VALID_TRANSITIONS. Note: there is deliberately no
 * on_hold → scheduled edge — un-hold to approved first.
 */
export const VALID_TRANSITIONS: Record<PlatformPostStatus, ReadonlySet<PlatformPostStatus>> = {
  draft: new Set(["pending_review", "scheduled", "publishing"]),
  pending_review: new Set(["approved", "changes_requested", "rejected"]),
  approved: new Set([
    "pending_client",
    "scheduled",
    "publishing",
    "draft",
    "on_hold",
    "pending_review",
  ]),
  pending_client: new Set(["approved", "changes_requested", "rejected"]),
  changes_requested: new Set(["pending_review", "draft"]),
  rejected: new Set(["draft", "pending_review"]),
  scheduled: new Set(["publishing", "draft"]),
  publishing: new Set(["published", "failed", "scheduled"]), // scheduled = retry
  failed: new Set(["publishing", "draft", "scheduled"]),
  on_hold: new Set(["approved", "draft", "changes_requested"]),
  published: new Set([]), // terminal
};

/** Statuses never removed by accidental deletion paths. */
export const PROTECTED_STATUSES: ReadonlySet<PlatformPostStatus> = new Set([
  "published",
  "publishing",
]);

export function canTransitionTo(from: PlatformPostStatus, to: PlatformPostStatus): boolean {
  return VALID_TRANSITIONS[from].has(to);
}

export function isEditable(status: PostStatus): boolean {
  return ["draft", "changes_requested", "rejected", "approved", "scheduled"].includes(status);
}

export function isSchedulable(status: PostStatus): boolean {
  return status === "draft" || status === "approved";
}
