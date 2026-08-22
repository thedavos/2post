import { Module } from "@nestjs/common";

import { DiscoveryController } from "./discovery.controller";
import { OAuthServerController } from "./oauth-server.controller";
import { OAuthServerService } from "./oauth-server.service";

@Module({
  controllers: [OAuthServerController, DiscoveryController],
  providers: [OAuthServerService],
  exports: [OAuthServerService],
})
export class OAuthServerModule {}
