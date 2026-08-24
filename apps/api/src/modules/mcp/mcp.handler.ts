import { Injectable, NotFoundException } from "@nestjs/common";

import type { ApiKeyRequest } from "../api-keys/api-key.guard";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * MCP (Model Context Protocol) JSON-RPC 2.0 handler — parity with apps/mcp:
 * initialize / tools/list / tools/call over Streamable HTTP. Tool names and
 * payload shapes are a frozen external contract.
 */
@Injectable()
export class McpHandler {
  constructor(private readonly prisma: PrismaService) {}

  async handle(body: unknown, request?: ApiKeyRequest): Promise<Record<string, unknown>> {
    const rpc = body as {
      id?: number | string | null;
      method?: string;
      params?: Record<string, unknown>;
    };

    switch (rpc.method) {
      case "initialize":
        return this.result(rpc.id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "brightbean-studio", version: "1.0.0" },
        });
      case "ping":
        return this.result(rpc.id, {});
      case "tools/list":
        return this.result(rpc.id, { tools: this.toolCatalog() });
      case "tools/call": {
        const name = String(rpc.params?.["name"] ?? "");
        const args = (rpc.params?.["arguments"] ?? {}) as Record<string, unknown>;
        try {
          const data = await this.callTool(name, args, request);
          return this.result(rpc.id, {
            content: [{ type: "text", text: JSON.stringify(data) }],
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return this.result(rpc.id, {
            content: [{ type: "text", text: message }],
            isError: true,
          });
        }
      }
      default:
        return {
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          error: { code: -32601, message: `Method not found: ${rpc.method}` },
        };
    }
  }

  private toolCatalog(): Array<Record<string, unknown>> {
    return [
      {
        name: "list_accounts",
        description: "List connected social accounts the key can act on",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_post",
        description: "Retrieve one post with aggregate status and per-platform state",
        inputSchema: {
          type: "object",
          properties: { post_id: { type: "string" } },
          required: ["post_id"],
        },
      },
      {
        name: "create_draft",
        description: "Create a draft post (caption/title/first comment)",
        inputSchema: {
          type: "object",
          properties: {
            caption: { type: "string" },
            title: { type: "string" },
            first_comment: { type: "string" },
            account_ids: { type: "array", items: { type: "string" } },
          },
          required: ["caption", "account_ids"],
        },
      },
      {
        name: "cancel_post",
        description: "Revert a scheduled post back to draft",
        inputSchema: {
          type: "object",
          properties: { post_id: { type: "string" } },
          required: ["post_id"],
        },
      },
      {
        name: "search_media",
        description: "Find media assets by filename substring",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" }, limit: { type: "integer" } },
        },
      },
    ];
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
    request?: ApiKeyRequest,
  ): Promise<unknown> {
    if (!request) throw new Error("Unauthenticated tool call");

    const workspaceId = request.apiKey.workspaceId;
    const perms = ((request.apiKey.permissions as unknown as string[]) ?? []) as string[];

    switch (name) {
      case "list_accounts": {
        const accounts = await this.prisma.socialAccount.findMany({
          where: { workspaceId, connectionStatus: "CONNECTED" },
          select: {
            id: true,
            platform: true,
            accountName: true,
            accountHandle: true,
            followerCount: true,
          },
        });
        return { accounts };
      }

      case "get_post": {
        const postId = String(args["post_id"] ?? "");
        const post = await this.prisma.post.findFirst({
          where: { id: postId, workspaceId },
          include: {
            platformPosts: {
              select: {
                status: true,
                platformPostId: true,
                socialAccount: { select: { platform: true } },
              },
            },
          },
        });
        if (!post) throw new NotFoundException("Post not found");
        return post;
      }

      case "create_draft": {
        if (!perms.includes("create_posts")) throw new Error("create_posts permission required");
        const caption = String(args["caption"] ?? "");
        const accountIds = (args["account_ids"] as string[]) ?? [];
        const title = args["title"] ? String(args["title"]) : "";
        const firstComment = args["first_comment"] ? String(args["first_comment"]) : "";

        const accounts = await this.prisma.socialAccount.findMany({
          where: { id: { in: accountIds }, workspaceId },
          select: { id: true },
        });
        if (accounts.length === 0) throw new Error("No valid accounts for this workspace");

        const created = await this.prisma.post.create({
          data: {
            workspaceId,
            title,
            caption,
            firstComment,
            platformPosts: {
              create: accounts.map((a) => ({ socialAccountId: a.id })),
            },
          },
          select: { id: true },
        });
        return { post_id: created.id };
      }

      case "cancel_post": {
        const postId = String(args["post_id"] ?? "");
        const result = await this.prisma.platformPost.updateMany({
          where: { postId, status: "SCHEDULED", post: { workspaceId } },
          data: { status: "DRAFT", scheduledAt: null },
        });
        await this.prisma.post.updateMany({
          where: { id: postId, workspaceId },
          data: { scheduledAt: null },
        });
        void result;
        return { ok: true };
      }

      case "search_media": {
        const query = String(args["query"] ?? "");
        const limit = Math.min(Number(args["limit"] ?? 20) || 20, 100);
        const results = await this.prisma.mediaAsset.findMany({
          where: {
            OR: [{ workspaceId }, { organizationId: null }],
            originalFilename: query ? { contains: query } : undefined,
          },
          select: {
            id: true,
            mediaType: true,
            originalFilename: true,
            fileSizeBytes: true,
            altText: true,
          },
          take: limit,
        });
        return { results };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private result(id: unknown, result: unknown): Record<string, unknown> {
    return { jsonrpc: "2.0", id: id ?? null, result };
  }
}
