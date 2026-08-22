import { Injectable } from "@nestjs/common";
import { createHmac, createHash, randomBytes } from "node:crypto";

import { PrismaService } from "../../prisma/prisma.service";

const STATE_SALT = "social-oauth-state";
/// 15 minutes — matches the legacy OAUTH_STATE_MAX_AGE intent.
export const STATE_MAX_AGE_SECONDS = 15 * 60;

export interface SignedStatePayload {
  workspaceId: string;
  platform: string;
  userId: string;
  nonce: string;
}

/**
 * OAuth state signing ported from apps/social_accounts/views.py
 * (_sign_state/_unsign_state). Django used signed cookies with a salt;
 * here we HMAC the payload with a key derived from SECRET_KEY and verify
 * server-side against a stored nonce hash (single use).
 */
@Injectable()
export class OauthStateService {
  constructor(private readonly prisma: PrismaService) {}

  private key(): Buffer {
    const secret = process.env.SECRET_KEY ?? "";
    return createHash("sha256").update(`${secret}:${STATE_SALT}`).digest();
  }

  async issue(payload: Omit<SignedStatePayload, "nonce">, codeVerifier?: string): Promise<string> {
    const nonce = randomBytes(24).toString("base64url");

    await this.prisma.oauthConnectRequest.create({
      data: {
        userId: payload.userId,
        workspaceId: payload.workspaceId,
        platform: payload.platform,
        nonceHash: sha256(nonce),
        codeVerifier: codeVerifier ?? null,
        expiresAt: new Date(Date.now() + STATE_MAX_AGE_SECONDS * 1000),
      },
    });

    const body = Buffer.from(JSON.stringify({ ...payload, nonce })).toString("base64url");
    const signature = createHmac("sha256", this.key()).update(body).digest("base64url");
    return `${body}.${signature}`;
  }

  /** Verifies signature, expiry, single-use nonce and returns the payload. */
  async consume(state: string): Promise<SignedStatePayload | null> {
    const dot = state.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = state.slice(0, dot);
    const signature = state.slice(dot + 1);

    const expected = createHmac("sha256", this.key()).update(body).digest("base64url");
    if (
      expected.length !== signature.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      return null;
    }

    let payload: SignedStatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedStatePayload;
    } catch {
      return null;
    }
    if (!payload.nonce || !payload.workspaceId || !payload.platform || !payload.userId) {
      return null;
    }

    const request = await this.prisma.oauthConnectRequest.findUnique({
      where: { nonceHash: sha256(payload.nonce) },
    });
    if (!request || request.expiresAt < new Date()) return null;

    // Single use.
    await this.prisma.oauthConnectRequest.delete({ where: { id: request.id } }).catch(() => {});

    return payload;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
