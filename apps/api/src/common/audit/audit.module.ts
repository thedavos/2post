import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuditLogInterceptor } from "./audit-log.interceptor";

@Module({
  imports: [PrismaModule],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor }],
})
export class AuditModule {}
