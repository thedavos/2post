/**
 * TanStack Query key factories. Single source of truth so invalidation
 * after mutations is consistent across the app.
 */
export const queryKeys = {
  me: ["me"] as const,
  notifications: {
    unreadCount: ["notifications", "unread-count"] as const,
    list: (params?: Record<string, unknown>) => ["notifications", "list", params ?? {}] as const,
  },
  organizations: {
    list: ["organizations", "list"] as const,
    detail: (orgId: string) => ["organizations", "detail", orgId] as const,
    apiKeys: (orgId: string) => ["organizations", orgId, "api-keys"] as const,
  },
  workspaces: {
    list: (orgId: string) => ["workspaces", "list", orgId] as const,
    detail: (workspaceId: string) => ["workspaces", "detail", workspaceId] as const,
  },
  members: {
    list: (workspaceId: string) => ["members", "list", workspaceId] as const,
    invitations: (workspaceId: string) => ["members", "invitations", workspaceId] as const,
  },
  socialAccounts: {
    list: (orgId: string) => ["social-accounts", "list", orgId] as const,
  },
  composer: {
    post: (postId: string) => ["posts", "detail", postId] as const,
    list: (workspaceId: string, params?: Record<string, unknown>) =>
      ["posts", "list", workspaceId, params ?? {}] as const,
    templates: (workspaceId: string) => ["post-templates", workspaceId] as const,
  },
  calendar: {
    events: (workspaceId: string, params: Record<string, unknown>) =>
      ["calendar", "events", workspaceId, params] as const,
    queues: (workspaceId: string) => ["calendar", "queues", workspaceId] as const,
    slots: (workspaceId: string) => ["calendar", "slots", workspaceId] as const,
  },
  inbox: {
    threads: (workspaceId: string, params?: Record<string, unknown>) =>
      ["inbox", "threads", workspaceId, params ?? {}] as const,
    thread: (threadId: string) => ["inbox", "thread", threadId] as const,
  },
  analytics: {
    account: (accountId: string, window: number) =>
      ["analytics", "account", accountId, window] as const,
    post: (postId: string) => ["analytics", "post", postId] as const,
  },
  media: {
    list: (workspaceId: string, folderId?: string | null) =>
      ["media", "list", workspaceId, folderId ?? null] as const,
  },
} as const;
