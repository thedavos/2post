import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "../../generated/prisma";

/**
 * Prisma connects lazily on first query, so the process boots even when the
 * database is unreachable (health checks stay green); queries fail fast
 * until DATABASE_URL points at a live PostgreSQL.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
