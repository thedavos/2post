import { z } from "zod";

export const emailSchema = z.string().email().max(254);
export const passwordSchema = z.string().min(8).max(128);

export const loginInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const signupInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(1).max(120),
  acceptTos: z.literal(true),
});
export type SignupInput = z.infer<typeof signupInputSchema>;

export const organizationCreateSchema = z.object({
  name: z.string().min(1).max(120),
});
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;

export const workspaceCreateSchema = z.object({
  name: z.string().min(1).max(120),
});
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>;

export const inviteInputSchema = z.object({
  email: emailSchema,
  orgRole: z.enum(["owner", "admin", "member"]).default("member"),
  /** { [workspaceId]: workspaceRole } — parity with legacy invite form. */
  workspaceRoles: z.record(z.string(), z.enum(["owner", "manager", "editor", "contributor", "client", "viewer"])).default({}),
});
export type InviteInput = z.infer<typeof inviteInputSchema>;
