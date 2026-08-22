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
