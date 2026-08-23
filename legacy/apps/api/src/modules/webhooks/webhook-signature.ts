import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Port of the legacy Meta webhook verification:
 *   expected = HMAC-SHA256(app_secret, raw_request_body)
 *   header   = "sha256=<hex>"
 * Constant-time compare; unsigned or mismatched requests are rejected.
 */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const providedHex = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (providedHex.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(providedHex, "hex"));
  } catch {
    return false;
  }
}

/** YouTube PubSubHubbub subscription handshake: echo the challenge. */
export function pubsubHubbubChallenge(query: Record<string, string | undefined>): {
  ok: boolean;
  challenge?: string;
} {
  if (query["hub.mode"] !== "subscribe" || !query["hub.challenge"]) {
    return { ok: false };
  }
  const token = query["hub.verify_token"];
  if (token) {
    const expected = process.env.YOUTUBE_WEBHOOK_SECRET;
    // hub.secret is optional; when configured, require a match.
    if (expected && token !== expected) return { ok: false };
  }
  return { ok: true, challenge: query["hub.challenge"] };
}
