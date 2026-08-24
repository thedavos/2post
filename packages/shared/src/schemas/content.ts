import { z } from "zod";

export const postTargetSchema = z.object({
  socialAccountId: z.string().uuid(),
  caption: z.string().max(100_000).nullish(),
  title: z.string().max(500).nullish(),
  firstComment: z.string().max(10_000).nullish(),
});

export const postCreateSchema = z.object({
  title: z.string().max(255).default(""),
  caption: z.string().max(100_000).default(""),
  firstComment: z.string().max(10_000).default(""),
  internalNotes: z.string().max(20_000).default(""),
  tags: z.array(z.string().max(100)).default([]),
  categoryId: z.string().uuid().nullish(),
  scheduledAt: z.coerce.date().nullish(),
  targets: z.array(postTargetSchema).min(1),
});
export type PostCreateInput = z.infer<typeof postCreateSchema>;

export const postUpdateSchema = z.object({
  title: z.string().max(255).optional(),
  caption: z.string().max(100_000).optional(),
  firstComment: z.string().max(10_000).optional(),
  internalNotes: z.string().max(20_000).optional(),
  tags: z.array(z.string().max(100)).optional(),
  categoryId: z.string().uuid().nullish(),
});
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;

export const postScheduleSchema = z.object({
  scheduledAt: z.coerce.date(),
});
export const platformPostTransitionSchema = z.object({
  status: z.enum([
    "draft",
    "pending_review",
    "pending_client",
    "approved",
    "changes_requested",
    "rejected",
    "scheduled",
    "publishing",
    "failed",
    "on_hold",
  ]),
  scheduledAt: z.coerce.date().nullish(),
});

export const slotCreateSchema = z.object({
  dayOfWeek: z.enum([
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ]),
  /** HH:MM in the workspace timezone. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const queueCreateSchema = z.object({
  name: z.string().min(1).max(100),
  categoryId: z.string().uuid().nullish(),
  accountId: z.string().uuid().nullish(),
});

export const queueEntryAddSchema = z.object({
  postId: z.string().uuid(),
});
