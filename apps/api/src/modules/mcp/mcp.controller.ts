import { BadRequestException, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { ApiKeyGuard } from "../api-keys/api-key.guard";
import { McpHandler } from "./mcp.handler";

@Controller()
export class McpController {
  constructor(private readonly handler: McpHandler) {}

  /// Frozen external contract: POST /api/v1/mcp (JSON-RPC 2.0).
  /// Authenticated via API key bearer or OAuth bearer (OAuth wiring in the
  /// oauth-server module); tools resolve against the caller's workspace scope.
  @Post("api/v1/mcp")
  @UseGuards(ApiKeyGuard)
  async endpoint(@Req() request: FastifyRequest): Promise<Record<string, unknown>> {
    const body = request.body as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Invalid JSON-RPC request");
    }
    return this.handler.handle(body, request as never);
  }
}
