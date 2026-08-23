import { Controller, Get } from "@nestjs/common";

import { APP_URL } from "./oauth.constants";

/**
 * RFC 8414 (authorization server) + RFC 9728 (protected resource) discovery
 * documents. Paths are frozen external contracts consumed by MCP clients.
 */
@Controller()
export class DiscoveryController {
  @Get(".well-known/oauth-authorization-server")
  metadata() {
    const base = APP_URL;
    return {
      issuer: base || undefined,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      scopes_supported: [],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      service_documentation: `${base}/docs`,
    };
  }

  /// RFC 9728: resource indicator for the MCP endpoint (+ path-scoped variant).
  @Get(".well-known/oauth-protected-resource")
  protectedResourceRoot() {
    return this.protected(`${APP_URL}/api/v1/mcp`);
  }

  @Get(".well-known/oauth-protected-resource/api/v1/mcp")
  protectedResourceMcp() {
    return this.protected(`${APP_URL}/api/v1/mcp`);
  }

  private protected(resource: string) {
    const base = APP_URL;
    return {
      resource,
      authorization_servers: [base],
      scopes_supported: [],
      bearer_methods_supported: ["header"],
      resource_documentation: `${base}/docs`,
    };
  }
}
