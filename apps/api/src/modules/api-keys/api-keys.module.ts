import { Module } from "@nestjs/common";

import { ApiKeyGuard } from "./api-key.guard";
import { ApiKeysController } from "./api-keys.controller";

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard],
})
export class ApiKeysModule {}
