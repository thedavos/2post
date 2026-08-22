import { Injectable } from "@nestjs/common";

/**
 * Minimal MCP (Model Context Protocol) JSON-RPC 2.0 handler — parity with
 * apps/mcp: initialize / tools/list / tools/call over Streamable HTTP.
 * Tool set grows with each domain phase; names/payloads stay stable.
 */
@Injectable()
export class McpHandler {
  async handle(body: unknown): Promise<Record<string, unknown>> {
    const request = body as {
      id?: number | string | null;
      method?: string;
      params?: Record<string, unknown>;
    };

    switch (request.method) {
      case "initialize":
        return this.result(request.id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "brightbean-studio", version: "1.0.0" },
        });
      case "ping":
        return this.result(request.id, {});
      case "tools/list":
        return this.result(request.id, {
          tools: [
            { name: "list_accounts", description: "List connected social accounts", inputSchema: { type: "object", properties: {} } },
            { name: "get_post", description: "Get aggregate status for one post", inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"] } },
          ],
        });
      case "tools/call": {
        const name = String(request.params?.["name"] ?? "");
        const args = (request.params?.["arguments"] ?? {}) as Record<string, unknown>;
        const data = await this.callTool(name, args);
        return this.result(request.id, {
          content: [{ type: "text", text: JSON.stringify(data) }],
        });
      }
      default:
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
    }
  }

  private async callTool(name: string, _args: Record<string, unknown>): Promise<unknown> {
    // Tool implementations resolve against the authenticated API key's scope.
    if (name === "list_accounts") return { accounts: [] };
    if (name === "get_post") {
      throw new Error("get_post lands with the MCP storage wiring");
    }
    throw new Error(`Unknown tool: ${name}`);
  }

  private result(id: unknown, result: unknown): Record<string, unknown> {
    return { jsonrpc: "2.0", id: id ?? null, result };
  }
}
