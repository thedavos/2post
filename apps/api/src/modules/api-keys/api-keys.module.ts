import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { ApiKeyGuard } from "./api-key.guard";
import { ApiKeysController } from "./api-keys.controller";
import { RateLimitService } from "./rate-limit.service";

@Module({
  imports: [PrismaModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyGuard, RateLimitService],
  exports: [ApiKeyGuard],
})
export class ApiKeysModule {}
