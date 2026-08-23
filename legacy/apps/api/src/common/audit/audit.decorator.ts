import { SetMetadata } from "@nestjs/common";

import { AUDIT_ACTION_KEY } from "./audit-log.interceptor";

/** Marks a route's successful mutation for the audit log. */
export function AuditAction(action: string): MethodDecorator {
  return SetMetadata(AUDIT_ACTION_KEY, action);
}
