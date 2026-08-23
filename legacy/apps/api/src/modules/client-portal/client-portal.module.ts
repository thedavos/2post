import { Module } from "@nestjs/common";

import { ClientPortalController, ClientPortalAdminController } from "./client-portal.controller";
import { ClientPortalService } from "./client-portal.service";

@Module({
  controllers: [ClientPortalController, ClientPortalAdminController],
  providers: [ClientPortalService],
  exports: [ClientPortalService],
})
export class ClientPortalModule {}
