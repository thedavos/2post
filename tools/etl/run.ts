/**
 * ETL orchestrator — Django schema → Prisma schema.
 *
 * Env:
 *   DATABASE_URL        source (legacy Django PostgreSQL, read-only)
 *   TARGET_DATABASE_URL target (new-stack Prisma PostgreSQL)
 *   DRY_RUN=1           count/report without writing (except etl_state)
 *
 * Each step is checkpointed in the target's etl_state table; a resumed run
 * skips completed steps. Run: pnpm --filter @brightbean/etl start [-- --only 01_users]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { PrismaClient } from "../../apps/api/generated/prisma";

export interface StepContext {
  src: Client;
  dst: PrismaClient;
  dryRun: boolean;
  log: (msg: string) => void;
}

export interface Step {
  id: string;
  description: string;
  run: (ctx: StepContext) => Promise<void>;
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const onlyFlag = (() => {
  const idx = args.indexOf("--only");
  return idx >= 0 ? args[idx + 1] : null;
})();
export const FRESH = args.includes("--fresh");

export const DRY_RUN = process.env.DRY_RUN === "1";

function envUrl(name: string): string {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is required`);
  // Prisma URLs use postgresql:// — pg accepts both, keep as-is.
  return raw;
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

const steps: Step[] = [
  {
    id: "01_users",
    description: "users (+ password hashes verbatim)",
    async run({ src, dst, dryRun, log }) {
      const { rows } = await src.query(
        `SELECT id::text, email, password, name, is_active,
                is_superuser, created_at, last_login, tos_accepted_at
         FROM accounts_user ORDER BY created_at ASC`,
      );
      log(`source rows: ${rows.length}`);
      if (dryRun) return;

      for (const r of rows) {
        const displayName = r.name || null;
        await dst.user.upsert({
          where: { email: r.email },
          create: {
            id: r.id,
            email: r.email,
            passwordHash: r.password ?? null,
            displayName,
            isActive: r.is_active,
            isSuperuser: r.is_superuser,
            tosAcceptedAt: r.tos_accepted_at ?? null,
            lastLoginAt: r.last_login ?? null,
            createdAt: r.created_at,
            updatedAt: new Date(),
          },
          update: {},
        });
      }
    },
  },
  {
    id: "02_orgs_workspaces_members",
    description: "organizations → workspaces → org memberships (+ owner role)",
    async run({ src, dst, dryRun, log }) {
      const { rows: orgs } = await src.query(
        `SELECT id::text, name, created_at FROM organizations_organization `,
      );
      const { rows: ws } = await src.query(
        `SELECT id::text, organization_id::text AS org_id, name FROM workspaces_workspace`,
      );
      const { rows: members } = await src.query(
        `SELECT id::text, user_id::text AS user_id, organization_id::text AS org_id,
                org_role FROM members_org_membership`,
      );
      log(`orgs: ${orgs.length}, workspaces: ${ws.length}, memberships: ${members.length}`);
      if (dryRun) return;

      for (const o of orgs) {
        await dst.organization.upsert({
          where: { id: o.id },
          create: { id: o.id, name: o.name, slug: `org-` + o.id.slice(0, 8), createdAt: o.created_at },
          update: {},
        });
      }
      for (const w of ws) {
        await dst.workspace.upsert({
          where: { id: w.id },
          create: {
            id: w.id,
            organizationId: w.org_id,
            name: w.name,
            slug: "ws-" + w.id.slice(0, 8),
          },
          update: {},
        });
      }
      for (const m of members) {
        await dst.orgMembership.upsert({
          where: { userId_organizationId: { userId: m.user_id, organizationId: m.org_id } },
          create: {
            userId: m.user_id,
            organizationId: m.org_id,
            orgRole: m.org_role.toUpperCase() as "OWNER" | "ADMIN" | "MEMBER",
          },
          update: {},
        });

        // Auto-provision workspace memberships for all org workspaces
        // (legacy Django uses org-level access + per-workspace checks).
        const roleMap: Record<string, string> = {
          OWNER: "OWNER",
          ADMIN: "MANAGER",
          MEMBER: "EDITOR",
        };
        const wsRole = roleMap[m.org_role.toUpperCase()] ?? "VIEWER";
        for (const w of ws) {
          if (w.org_id !== m.org_id) continue;
          const existing = await dst.workspaceMembership.findUnique({
            where: { userId_workspaceId: { userId: m.user_id, workspaceId: w.id } },
          });
          if (!existing) {
            await dst.workspaceMembership.create({
              data: {
                userId: m.user_id,
                workspaceId: w.id,
                workspaceRole: wsRole as never,
              },
            });
          }
        }
      }
    },
  },
  {
    id: "03_social_accounts",
    description: "social accounts (ciphertext tokens byte-copied)",
    async run({ src, dst, dryRun, log }) {
      const { rows } = await src.query(
        `SELECT id::text, workspace_id::text AS workspace_id, platform,
                account_platform_id, account_name, account_handle,
                avatar_url, follower_count, oauth_access_token,
                oauth_refresh_token, token_expires_at, instance_url,
                connection_status, created_at
         FROM social_accounts_social_account`,
      );
      log(`rows: ${rows.length}`);
      if (dryRun) return;

      for (const r of rows) {
        await dst.socialAccount.upsert({
          where: {
            workspaceId_platform_accountPlatformId: {
              workspaceId: r.workspace_id,
              platform: r.platform,
              accountPlatformId: r.account_platform_id,
            },
          },
          create: {
            id: r.id,
            workspaceId: r.workspace_id,
            platform: r.platform,
            accountPlatformId: r.account_platform_id,
            accountName: r.account_name,
            accountHandle: r.account_handle,
            avatarUrl: r.avatar_url ?? "",
            followerCount: r.follower_count ?? 0,
            oauthAccessToken: r.oauth_access_token || null,
            oauthRefreshToken: r.oauth_refresh_token || null,
            tokenExpiresAt: r.token_expires_at ?? null,
            instanceUrl: r.instance_url ?? "",
            connectionStatus:
              (r.connection_status as string).toUpperCase() as never,
            createdAt: r.created_at,
          },
          update: {},
        });
      }
    },
  },
  {
    id: "04_composer_posts",
    description: "categories + posts + platform posts (state machine statuses)",
    async run({ src, dst, dryRun, log }) {
      const { rows: cats } = await src.query(
        `SELECT id::text, workspace_id::text AS workspace_id, name, color, position,
                created_at FROM composer_content_category`,
      );
      const { rows: posts } = await src.query(
        `SELECT id::text, workspace_id::text AS workspace_id, author_id::text AS author_id,
                title, caption, first_comment, internal_notes, tags,
                category_id::text AS category_id, scheduled_at, published_at,
                proposed_publish_at, created_at
         FROM composer_post`,
      );
      const { rows: pps } = await src.query(
        `SELECT id::text, post_id::text AS post_id, social_account_id::text AS social_account_id,
                status, scheduled_at, retry_count, next_retry_at, created_at
         FROM composer_platform_post`,
      );
      log(`posts: ${posts.length}, platform posts: ${pps.length}`);
      if (dryRun) return;

      for (const c of cats) {
        await dst.contentCategory.upsert({
          where: { id: c.id },
          create: {
            id: c.id,
            workspaceId: c.workspace_id,
            name: c.name,
            color: c.color,
            position: c.position,
          },
          update: {},
        });
      }

      const validPosts = posts.filter((p) => !p.category_id || cats.some((c) => c.id === p.category_id));
      for (const p of validPosts) {
        await dst.post.upsert({
          where: { id: p.id },
          create: {
            id: p.id,
            workspaceId: p.workspace_id,
            authorId: p.author_id ?? null,
            title: p.title ?? "",
            caption: p.caption ?? "",
            firstComment: p.first_comment ?? "",
            internalNotes: p.internal_notes ?? "",
            tags: (p.tags ?? []) as never,
            categoryId: p.category_id ?? null,
            scheduledAt: p.scheduled_at ?? null,
            publishedAt: p.published_at ?? null,
            proposedPublishAt: p.proposed_publish_at ?? null,
            createdAt: p.created_at,
          },
          update: {},
        });
      }

      const postIds = new Set(validPosts.map((p) => p.id));
      const accountIds = new Set(
        (
          await src.query(`SELECT id::text FROM social_accounts_social_account`)
        ).rows.map((r) => r.id as string),
      );
      for (const pp of pps) {
        if (!postIds.has(pp.post_id) || !accountIds.has(pp.social_account_id)) continue;
        await dst.platformPost.upsert({
          where: { id: pp.id },
          create: {
            id: pp.id,
            postId: pp.post_id,
            socialAccountId: pp.social_account_id,
            status: pp.status.toUpperCase() as never,
            scheduledAt: pp.scheduled_at ?? null,
            retryCount: pp.retry_count ?? 0,
            createdAt: pp.created_at,
          },
          update: {},
        });
      }
    },
  },
  {
    id: "05_api_keys",
    description: "api keys (HMAC hashes byte-copied — keys stay valid)",
    async run({ src, dst, dryRun, log }) {
      const { rows } = await src.query(
        `SELECT k.id::text, k.workspace_id::text AS workspace_id, k.name,
                k.lookup_prefix, k.token_hash, k.permissions,
                k.issued_by_id::text AS issued_by_id, k.created_at
         FROM api_keys_api_key k WHERE k.revoked_at IS NULL`,
      );
      log(`rows: ${rows.length}`);
      if (dryRun) return;

      for (const r of rows) {
        await dst.apiKey.upsert({
          where: { lookupPrefix: r.lookup_prefix },
          create: {
            id: r.id,
            workspaceId: r.workspace_id,
            name: r.name,
            lookupPrefix: r.lookup_prefix,
            tokenHash: r.token_hash,
            permissions: (r.permissions ?? []) as never,
            issuedById: r.issued_by_id ?? null,
            createdAt: r.created_at,
          },
          update: {},
        });
      }
    },
  },
  {
    id: "06_inbox",
    description: "inbox messages (dedup by social account + platform msg id)",
    async run({ src, dst, dryRun, log }) {
      const { rows } = await src.query(
        `SELECT id::text, workspace_id::text AS workspace_id, social_account_id::text AS sa_id,
                platform_message_id, message_type, status, sentiment,
                sender_name, sender_handle, sender_avatar_url, body,
                extra, received_at
         FROM inbox_message`,
      );
      log(`rows: ${rows.length}`);
      if (dryRun) return;
      for (const r of rows) {
        await dst.inboxMessage.upsert({
          where: {
            socialAccountId_platformMessageId: {
              socialAccountId: r.sa_id,
              platformMessageId: r.platform_message_id,
            },
          },
          create: {
            id: r.id,
            workspaceId: r.workspace_id,
            socialAccountId: r.sa_id,
            platformMessageId: r.platform_message_id,
            messageType: r.message_type.toUpperCase() as never,
            status: r.status.toUpperCase() as never,
            sentiment: r.sentiment.toUpperCase() as never,
            senderName: r.sender_name ?? "",
            senderHandle: r.sender_handle ?? "",
            body: r.body ?? "",

            createdAt: r.created_at ?? r.received_at ?? new Date(),
          },
          update: {},
        });
      }
    },
  },
  {
    id: "07_media",
    description: "media assets (originals + variants metadata)",
    async run({ src, dst, dryRun, log }) {
      const { rows } = await src.query(
        `SELECT id::text, workspace_id::text AS workspace_id, media_type,
                filename, file AS storage_key, file_size, width, height,
                alt_text, processing_status, created_at
         FROM media_library_media_asset WHERE workspace_id IS NOT NULL`,
      );
      log(`assets: ${rows.length}`);
      if (dryRun) return;

      for (const r of rows) {
        // Legacy stores the file path in `file`; copy verbatim.
        const storageKey = String(r.file || "").replace(/^media\//, "");
        const asset = await dst.mediaAsset.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            workspaceId: r.workspace_id,
            mediaType: r.media_type || "document",
            originalFilename: r.filename || "unknown",
            storageKey,
            fileSizeBytes: r.file_size ?? 0,
            width: r.width,
            height: r.height,
            altText: r.alt_text ?? "",
            processingStatus: r.processing_status?.toUpperCase() === "COMPLETED" ? "COMPLETED" : "PENDING",
            createdAt: r.created_at,
          },
          update: {},
        });
        void asset;
      }
    },
  },
  {
    id: "08_tags",
    description: "composer tags",
    async run({ src, dst, dryRun, log }) {
      const { rows } = await src.query(
        `SELECT id::text, workspace_id::text AS workspace_id, name, created_at FROM composer_tag`,
      );
      log(`tags: ${rows.length}`);
      if (dryRun) return;
      for (const t of rows) {
        await dst.tag.upsert({
          where: { id: t.id },
          create: { id: t.id, workspaceId: t.workspace_id, name: t.name, createdAt: t.created_at },
          update: {},
        });
      }
    },
  },
  {
    id: "09_calendar",
    description: "posting slots, queues, queue entries",
    async run({ src, dst, dryRun, log }) {
      const { rows: slots } = await src.query(
        `SELECT id::text, social_account_id::text AS sa_id, day_of_week, time,
                is_active, created_at FROM calendar_posting_slot`,
      );
      const { rows: queues } = await src.query(
        `SELECT q.id::text, q.name, q.is_active, q.created_at,
                q.category_id::text AS category_id, q.social_account_id::text AS account_id,
                q.workspace_id::text AS workspace_id
         FROM calendar_queue q`,
      );
      const { rows: entries } = await src.query(
        `SELECT id::text, position, assigned_slot_datetime, queue_id::text AS queue_id,
                post_id::text AS post_id FROM calendar_queue_entry`,
      );
      log(`slots: ${slots.length}, queues: ${queues.length}, entries: ${entries.length}`);
      if (dryRun) return;

      for (const slot of slots) {
        await dst.postingSlot.upsert({
          where: { id: slot.id },
          create: {
            id: slot.id,
            socialAccountId: slot.sa_id,
            dayOfWeek: slot.day_of_week.toUpperCase() as never,
            time: String(slot.time).slice(0, 5),
            isActive: slot.is_active,
          },
          update: {},
        });
      }
      for (const q of queues) {
        await dst.queue.upsert({
          where: { id: q.id },
          create: {
            id: q.id,
            workspaceId: q.workspace_id,
            name: q.name,
            categoryId: q.category_id ?? null,
            accountId: q.account_id ?? null,
            isActive: q.is_active,
            createdAt: q.created_at,
          },
          update: {},
        });
      }
      for (const e of entries) {
        if (!(await dst.post.findUnique({ where: { id: e.post_id }, select: { id: true } }))) continue;
        if (!(await dst.queue.findUnique({ where: { id: e.queue_id }, select: { id: true } }))) continue;
        await dst.queueEntry.upsert({
          where: { id: e.id },
          create: {
            id: e.id,
            queueId: e.queue_id,
            postId: e.post_id,
            position: e.position ?? 0,
            assignedSlotDatetime: e.assigned_slot_datetime ?? null,
          },
          update: {},
        });
      }
    },
  },
  {
    id: "10_publish_logs",
    description: "publish logs + rate limit states",
    async run({ src, dst, dryRun, log }) {
      const { rows: logs } = await src.query(
        `SELECT id::text, platform_post_id::text AS pp_id, attempt_number,
                status_code, response_body, error_message, duration_ms, created_at
         FROM publisher_publish_log`,
      );
      const validPpIds = new Set(
        (
          await src.query("SELECT id::text FROM composer_platform_post")
        ).rows.map((r) => r.id as string),
      );
      log(`logs: ${logs.length}`);
      if (dryRun) return;

      for (const l of logs) {
        if (!validPpIds.has(l.pp_id)) continue;
        await dst.publishLog.upsert({
          where: { id: l.id },
          create: {
            id: l.id,
            platformPostId: l.pp_id,
            attemptNumber: l.attempt_number ?? 1,
            statusCode: l.status_code,
            responseBody: (l.response_body ?? "").slice(0, 10000),
            errorMessage: (l.error_message ?? "").slice(0, 10000),
            durationMs: l.duration_ms ?? 0,
            createdAt: l.created_at,
          },
          update: {},
        });
      }

      const { rows: rl } = await src.query(
        `SELECT id::text, social_account_id::text AS sa_id, platform,
                requests_remaining, window_resets_at FROM publisher_rate_limit_state`,
      );
      const { rows: validAccounts } = await src.query(
        "SELECT id::text FROM social_accounts_social_account",
      );
      const accountSet = new Set(validAccounts.map((r) => r.id as string));
      for (const r of rl) {
        if (!accountSet.has(r.sa_id)) continue;
        await dst.rateLimitState.upsert({
          where: {
            socialAccountId_platform: {
              socialAccountId: r.sa_id,
              platform: r.platform,
            },
          },
          create: {
            id: r.id,
            socialAccountId: r.sa_id,
            platform: r.platform,
            requestsRemaining: r.requests_remaining ?? -1,
            windowResetsAt: r.window_resets_at ?? null,
          },
          update: {},
        });
      }
    },
  },
  {
    id: "99_verify",
    description: "row-count verification report (source vs target)",
    async run({ src, dst, dryRun, log }) {
      void dryRun;
      const checks: Array<[string, string, string]> = [
        ["users", "accounts_user", "user"],
        ["organizations", "organizations_organization", "organization"],
        ["workspaces", "workspaces_workspace", "workspace"],
        ["org_memberships", "members_org_membership", "orgMembership"],
        ["social_accounts", "social_accounts_social_account", "socialAccount"],
        ["posts", "composer_post", "post"],
        ["platform_posts", "composer_platform_post", "platformPost"],
        ["api_keys", "api_keys_api_key", "apiKey"],
        ["inbox_messages", "inbox_message", "inboxMessage"],
        ["media_assets", "media_library_media_asset", "mediaAsset"],
        ["tags", "composer_tag", "tag"],
        ["posting_slots", "calendar_posting_slot", "postingSlot"],
        ["queues", "calendar_queue", "queue"],
        ["publish_logs", "publisher_publish_log", "publishLog"],
      ];

      let failures = 0;
      for (const [label, srcTable, prismaModel] of checks) {
        const { rows } = await src.query(`SELECT COUNT(*)::int AS n FROM ${srcTable}`);
        const srcCount = rows[0].n as number;
        const delegate = (dst as unknown as Record<
          string,
          { count: () => Promise<number> }
        >)[prismaModel];
        if (!delegate) throw new Error(`verify: no delegate for ${prismaModel}`);
        const dstCount = await delegate.count();
        const ok = Number(srcCount) === Number(dstCount);
        if (!ok) failures += 1;
        log(
          `${ok ? "✓" : "✗"} ${label}: source=${srcCount} target=${dstCount}`,
        );
      }
      if (failures > 0) throw new Error(`Verification failed for ${failures} table(s)`);
    },
  },
];

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

async function main() {
  const src = new Client({ connectionString: envUrl("DATABASE_URL") });
  const dst = new PrismaClient({
    datasources: { db: { url: process.env.TARGET_DATABASE_URL ?? process.env.DATABASE_URL } },
  });

  await src.connect();
  if (FRESH) {
    console.log("— fresh mode: truncating target domain tables + checkpoints —");
    await dst.$executeRawUnsafe(`
      TRUNCATE TABLE
        etl_state, audit_log, invitations, workspace_memberships,
        org_memberships, api_key_rate_limits, api_keys,
        post_metric_snapshots, publish_logs, platform_posts, posts,
        queue_entries, queues, posting_slots, rate_limit_states,
        inbox_replies, inbox_messages, media_assets, media_folders,
        notifications, notification_preferences, portal_access_tokens,
        content_categories, tags, ideas, idea_groups, social_accounts,
        sessions,
        workspaces, organizations, users
      RESTART IDENTITY CASCADE
    `);
  }

  // Ensure target schema exists before touching checkpoints.
  await dst.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS etl_state (
      step_id TEXT PRIMARY KEY,
      finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const selected = onlyFlag ? steps.filter((s) => s.id === onlyFlag || s.id === "99_verify") : steps;

  console.log(
    `ETL ${DRY_RUN ? "(dry-run) " : ""}— ${selected.length} step(s)${
      onlyFlag ? ` [${onlyFlag}]` : ""
    }`,
  );

  let completed = 0;
  for (const step of selected) {
    const state = await dst.$queryRawUnsafe<Array<{ finished_at: Date }>>(
      `SELECT finished_at FROM etl_state WHERE step_id = $1`,
      step.id,
    );
    if (Array.isArray(state) && state.length > 0 && !DRY_RUN) {
      console.log(`↷ ${step.id} already complete`);
      completed += 1;
      continue;
    }

    const ctx: StepContext = {
      src,
      dst,
      dryRun: DRY_RUN,
      log: (m) => console.log(`  ${step.id}: ${m}`),
    };

    try {
      await step.run(ctx);
      if (!DRY_RUN) {
        await dst.$executeRawUnsafe(
          `INSERT INTO etl_state (step_id) VALUES ($1) ON CONFLICT DO NOTHING`,
          step.id,
        );
      }
      console.log(`✓ ${step.id} — ${step.description}`);
      completed += 1;
    } catch (error) {
      console.error(`✗ ${step.id} FAILED:`, error);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`Done: ${completed}/${selected.length} steps.`);
  await src.end();
  await dst.$disconnect();

  void readFileSync;
  void join;
}

main().catch((err) => {
  console.error("ETL fatal:", err);
  process.exit(1);
});
