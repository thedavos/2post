/**
 * Recurring job schedule — parity with the post_migrate registrations in
 * each legacy Django app config (django-background-tasks). Seconds.
 *
 * IMPLEMENTED = processor exists and runs real logic.
 * PENDING jobs are registered at boot as log-only placeholders tied to
 * their migration phase (docs/migration/gaps.md).
 */
export const JOB_SCHEDULES = {
  "publish-due-posts": { seconds: 15, implemented: true },
  "notifications-retry": { seconds: 60, implemented: false },
  "inbox-sync": { seconds: 5 * 60, implemented: false },
  "idempotency-sweep": { seconds: 60 * 60, implemented: true },
  "approval-reminders": { seconds: 60 * 60, implemented: false },
  "media-pending-sweep": { seconds: 60 * 60, implemented: false },
  "analytics-sync": { seconds: 60 * 60, implemented: false },
  "oauth-token-refresh": { seconds: 6 * 3600, implemented: true },
  "account-health-check": { seconds: 6 * 3600, implemented: false },
  "intelligence-provisioning": { seconds: 6 * 3600, implemented: false },
  "session-cleanup": { seconds: 24 * 3600, implemented: true },
  "orphaned-media-sweep": { seconds: 24 * 3600, implemented: false },
} as const;

export type JobName = keyof typeof JOB_SCHEDULES;

export function cronFromSeconds(seconds: number): string {
  // pg-boss cron supports seconds field when > 59 use step syntax.
  if (seconds < 60) return `*/${seconds} * * * * *`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `0 */${minutes} * * * *`;
  const hours = Math.round(minutes / 60);
  return `0 0 */${hours} * * *`;
}
