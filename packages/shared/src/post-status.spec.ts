import { describe, expect, it } from "vitest";

import {
  canTransitionTo,
  derivePostStatus,
  type PlatformPostStatus,
} from "./post-status";

/**
 * Port of apps/composer/tests around derive_post_status + the
 * PlatformPost state machine (docs in apps/composer/status.py).
 */
describe("derivePostStatus", () => {
  it("empty → draft", () => {
    expect(derivePostStatus([])).toBe("draft");
  });

  it("all children share the same value → that value", () => {
    expect(derivePostStatus(["scheduled", "scheduled"])).toBe("scheduled");
  });

  it("all published → published", () => {
    expect(derivePostStatus(["published", "published"])).toBe("published");
  });

  it("all failed → failed", () => {
    expect(derivePostStatus(["failed", "failed"])).toBe("failed");
  });

  it("mix of published/failed → partially_published", () => {
    expect(derivePostStatus(["published", "failed"])).toBe("partially_published");
  });

  it("any failed + any non-terminal → publishing (in flight)", () => {
    expect(derivePostStatus(["failed", "scheduled"])).toBe("publishing");
  });

  it("lowest workflow status wins: (draft, scheduled) → draft", () => {
    expect(derivePostStatus(["draft", "scheduled"])).toBe("draft");
  });

  it("(pending_review, approved) → pending_review", () => {
    expect(derivePostStatus(["pending_review", "approved"])).toBe("pending_review");
  });

  it("on_hold ranks low so a held sibling isn't masked", () => {
    expect(derivePostStatus(["approved", "on_hold"])).toBe("on_hold");
  });
});

describe("state machine transitions", () => {
  const ok = (from: PlatformPostStatus, to: PlatformPostStatus) =>
    expect(canTransitionTo(from, to));

  it("matches the legacy transition table", () => {
    ok("draft", "pending_review").toBe(true);
    ok("draft", "scheduled").toBe(true);
    ok("draft", "published").toBe(false);
    ok("pending_review", "rejected").toBe(true);
    ok("rejected", "scheduled").toBe(false);
    ok("scheduled", "publishing").toBe(true);
    ok("publishing", "scheduled").toBe(true); // retry edge
    ok("publishing", "published").toBe(true);
    ok("published", "anything" as PlatformPostStatus).toBe(false); // terminal
  });

  it("has no on_hold → scheduled edge (must un-hold to approved first)", () => {
    expect(canTransitionTo("on_hold", "scheduled")).toBe(false);
    expect(canTransitionTo("on_hold", "approved")).toBe(true);
  });
});
