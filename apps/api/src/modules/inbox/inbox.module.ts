import { Module } from "@nestjs/common";

import { PublisherModule } from "../publisher/publisher.module";
import { InboxController } from "./inbox.controller";

@Module({
  imports: [PublisherModule],
  controllers: [InboxController],
})
export class InboxModule {}
