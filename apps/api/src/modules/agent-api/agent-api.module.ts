import { Module } from "@nestjs/common";

import { ApiKeysModule } from "../api-keys/api-keys.module";
import { AgentApiController } from "./agent-api.controller";

@Module({
  imports: [ApiKeysModule],
  controllers: [AgentApiController],
})
export class AgentApiModule {}
