import { Module } from "@nestjs/common";

import { McpController } from "./mcp.controller";
import { McpHandler } from "./mcp.handler";

@Module({
  controllers: [McpController],
  providers: [McpHandler],
})
export class McpModule {}
