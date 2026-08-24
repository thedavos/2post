import { createHash, randomBytes } from "node:crypto";

/** PKCE S256: BASE64URL(SHA256(verifier)) — RFC 7636. */
export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkce(
  method: string | undefined,
  challenge: string | undefined,
  verifier: string,
): { ok: boolean; reason?: string } {
  if (!challenge) return { ok: true }; // no PKCE on the grant — allowed for legacy clients
  const methodUpper = (method ?? "S256").toUpperCase();
  if (methodUpper !== "S256") {
    return { ok: false, reason: `transform algorithm not supported: ${method}` };
  }
  const expected = pkceS256(verifier);
  if (expected !== challenge) return { ok: false, reason: "PKCE check failed" };
  return { ok: true };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}
