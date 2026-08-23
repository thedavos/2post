import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { AccessTokenClaims } from "./auth.constants";
import type { AuthenticatedRequest } from "./jwt-auth.guard";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenClaims => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
