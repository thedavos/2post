import { Module } from "@nestjs/common";

import { CryptoModule } from "../../common/crypto/crypto.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { DevtoProvider } from "./providers/devto.provider";
import { BlueskyProvider } from "./providers/bluesky.provider";
import { MastodonProvider } from "./providers/mastodon.provider";
import { FacebookProvider } from "./providers/facebook.provider";
import { InstagramProvider } from "./providers/instagram.provider";
import { InstagramLoginProvider } from "./providers/instagram-login.provider";
import { ThreadsProvider } from "./providers/threads.provider";
import {
  LinkedInCompanyProvider,
  LinkedInPersonalProvider,
} from "./providers/linkedin.provider";
import { TikTokProvider } from "./providers/tiktok.provider";
import { YouTubeProvider } from "./providers/youtube.provider";
import { GoogleBusinessProvider } from "./providers/google-business.provider";
import { PinterestProvider } from "./providers/pinterest.provider";
import { PublisherEngine } from "./publisher.engine";
import { ProviderRegistry } from "./provider.registry";

export const PUBLISH_QUEUE = "publish-due-posts";

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [],
  providers: [
    DevtoProvider,
    BlueskyProvider,
    MastodonProvider,
    FacebookProvider,
    InstagramProvider,
    InstagramLoginProvider,
    ThreadsProvider,
    LinkedInPersonalProvider,
    LinkedInCompanyProvider,
    TikTokProvider,
    YouTubeProvider,
    GoogleBusinessProvider,
    PinterestProvider,
    {
      provide: ProviderRegistry,
      useFactory: (
        devto: DevtoProvider,
        bluesky: BlueskyProvider,
        mastodon: MastodonProvider,
        facebook: FacebookProvider,
        instagram: InstagramProvider,
        instagramLogin: InstagramLoginProvider,
        threads: ThreadsProvider,
        linkedinPersonal: LinkedInPersonalProvider,
        linkedinCompany: LinkedInCompanyProvider,
        tiktok: TikTokProvider,
        youtube: YouTubeProvider,
        googleBusiness: GoogleBusinessProvider,
        pinterest: PinterestProvider,
      ) => {
        const registry = new ProviderRegistry();
        for (const provider of [
          devto,
          bluesky,
          mastodon,
          facebook,
          instagram,
          instagramLogin,
          threads,
          linkedinPersonal,
          linkedinCompany,
          tiktok,
          youtube,
          googleBusiness,
          pinterest,
        ]) {
          registry.register(provider);
        }
        return registry;
      },
      inject: [
        DevtoProvider,
        BlueskyProvider,
        MastodonProvider,
        FacebookProvider,
        InstagramProvider,
        InstagramLoginProvider,
        ThreadsProvider,
        LinkedInPersonalProvider,
        LinkedInCompanyProvider,
        TikTokProvider,
        YouTubeProvider,
        GoogleBusinessProvider,
        PinterestProvider,
      ],
    },
    PublisherEngine,
  ],
  exports: [PublisherEngine, ProviderRegistry],
})
export class PublisherModule {}
