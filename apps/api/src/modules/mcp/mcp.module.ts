import { Module } from "@nestjs/common";

import { ApiKeysModule } from "../api-keys/api-keys.module";
import { McpController } from "./mcp.controller";
import { McpHandler } from "./mcp.handler";

@Module({
  imports: [ApiKeysModule],
  controllers: [McpController],
  providers: [McpHandler],
})
export class McpModule {}
