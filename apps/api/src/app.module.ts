import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { CryptoModule } from "./common/crypto/crypto.module";
import { ZodExceptionFilter } from "./common/filters/zod-exception.filter";
import { TenancyModule } from "./common/tenancy/tenancy.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { MembersModule } from "./modules/members/members.module";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    CryptoModule,
    TenancyModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    WorkspacesModule,
    MembersModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ZodExceptionFilter }],
})
export class AppModule {}
