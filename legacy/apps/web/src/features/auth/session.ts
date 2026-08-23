import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { api } from "~/lib/api";
import { queryKeys } from "@brightbean/shared";

export const sessionSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  isSuperuser: z.boolean(),
  tosAcceptedAt: z.string().nullable(),
  orgMemberships: z.array(
    z.object({
      organizationId: z.string(),
      orgRole: z.enum(["OWNER", "ADMIN", "MEMBER"]),
      organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    }),
  ),
});
export type Session = z.infer<typeof sessionSchema>;

export function sessionQuery() {
  return queryOptions({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const raw = await api.get<unknown>("/api/app/auth/session");
      return sessionSchema.parse(raw);
    },
    retry: false,
    staleTime: 60_000,
  });
}

export async function login(email: string, password: string): Promise<void> {
  await api.post("/api/app/auth/login", { email, password });
}

export async function logout(): Promise<void> {
  await api.post("/api/app/auth/logout");
}
