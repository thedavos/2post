import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { tap } from "rxjs";

import { PrismaService } from "../../prisma/prisma.service";

export const AUDIT_ACTION_KEY = "audit_action";

interface RequestWithAuth {
  method: string;
  url: string;
  params?: Record<string, string>;
  user?: { sub?: string };
}

/**
 * Writes an append-only AuditLog row for destructive actions marked with
 * @AuditAction("action.name") on POST/PATCH/DELETE routes. Failures never
 * break the request (legacy parity).
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const action = this.reflector.get<string>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    if (
      !action ||
      !["POST", "PATCH", "DELETE"].includes(request.method.toUpperCase())
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.write(action, request).catch(() => {
            // audit failures never break the request (legacy parity)
          });
        },
      }),
    );
  }

  private async write(action: string, request: RequestWithAuth): Promise<void> {
    const params = request.params ?? {};
    await this.prisma.auditLog.create({
      data: {
        actorUserId: request.user?.sub ?? null,
        action,
        targetType: action.split(".")[0] ?? null,
        targetId:
          params.postId ??
          params.workspaceId ??
          params.accountId ??
          params.assetId ??
          params.orgId ??
          null,
        metadata: {
          method: request.method,
          url: request.url,
        } as never,
      },
    });
  }
}
