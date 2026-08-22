import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { CryptoModule } from "./common/crypto/crypto.module";
import { ZodExceptionFilter } from "./common/filters/zod-exception.filter";
import { TenancyModule } from "./common/tenancy/tenancy.module";
import { CalendarModule } from "./modules/calendar/calendar.module";
import { ComposerModule } from "./modules/composer/composer.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { MembersModule } from "./modules/members/members.module";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { SocialAccountsModule } from "./modules/social-accounts/social-accounts.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";
import { InboxModule } from "./modules/inbox/inbox.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { MediaModule } from "./modules/media/media.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ClientPortalModule } from "./modules/client-portal/client-portal.module";
import { ApiKeysModule } from "./modules/api-keys/api-keys.module";
import { AgentApiModule } from "./modules/agent-api/agent-api.module";
import { McpModule } from "./modules/mcp/mcp.module";
import { StorageModule } from "./common/storage/storage.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    CryptoModule,
    StorageModule,
    TenancyModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    WorkspacesModule,
    MembersModule,
    ComposerModule,
    CalendarModule,
    SocialAccountsModule,
    WebhooksModule,
    InboxModule,
    AnalyticsModule,
    MediaModule,
    NotificationsModule,
    ClientPortalModule,
    ApiKeysModule,
    AgentApiModule,
    McpModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ZodExceptionFilter }],
})
export class AppModule {}
