import { z } from "zod";

export const emailSchema = z.string().email().max(254);
export const passwordSchema = z.string().min(8).max(128);

export const loginInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginInputSchema>;
