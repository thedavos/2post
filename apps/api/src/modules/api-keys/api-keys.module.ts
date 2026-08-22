import { Global, Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { ApiKeyGuard } from "./api-key.guard";
import { ApiKeysController } from "./api-keys.controller";
import { RateLimitService } from "./rate-limit.service";

/// Global: class-based guards (@UseGuards(ApiKeyGuard)) are instantiated
/// inside each consuming module, so the guard + rate limiter must be
/// reachable from every module that touches /api/v1.
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyGuard, RateLimitService],
  exports: [ApiKeyGuard, RateLimitService],
})
export class ApiKeysModule {}
