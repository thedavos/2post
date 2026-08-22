import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { WebhooksController } from "./webhooks.controller";

@Module({
  imports: [PrismaModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
