import { Module } from "@nestjs/common";

import { PublisherModule } from "../publisher/publisher.module";
import { OauthCallbackController } from "./oauth-callback.controller";
import { OauthStateService } from "./oauth-state.service";
import { SocialAccountsController } from "./social-accounts.controller";
import { SocialAccountsService } from "./social-accounts.service";

@Module({
  imports: [PublisherModule],
  controllers: [SocialAccountsController, OauthCallbackController],
  providers: [SocialAccountsService, OauthStateService],
  exports: [SocialAccountsService],
})
export class SocialAccountsModule {}
