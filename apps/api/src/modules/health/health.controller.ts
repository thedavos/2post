import { Controller, Get } from "@nestjs/common";

/**
 * Parity with legacy Django health check: GET /health/ (trailing slash
 * tolerated via Fastify ignoreTrailingSlash). Caddy routes this path here.
 */
@Controller()
export class HealthController {
  @Get("health")
  check() {
    return { status: "ok" };
  }
}
