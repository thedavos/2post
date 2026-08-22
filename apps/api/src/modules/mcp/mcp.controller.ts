import { BadRequestException, Controller, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { McpHandler } from "./mcp.handler";

@Controller()
export class McpController {
  constructor(private readonly handler: McpHandler) {}

  /// Frozen external contract: POST /api/v1/mcp (JSON-RPC 2.0).
  @Post("api/v1/mcp")
  async endpoint(@Req() request: FastifyRequest): Promise<Record<string, unknown>> {
    const body = request.body as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Invalid JSON-RPC request");
    }
    void this;
    return this.handler.handle(body);
  }
}
