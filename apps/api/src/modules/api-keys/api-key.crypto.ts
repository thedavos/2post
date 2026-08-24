import { createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Byte-compatible port of apps/api_keys/services.py.
 *
 * Token format:  bb_studio_<random32urlsafe>_<lookup8hex>
 * At rest:       lookupPrefix = sha256(random)[0:8]
 *                tokenHash    = HMAC-SHA256(pepper, random)
 * pepper         = HKDF-SHA256(SECRET_KEY, salt=ENCRYPTION_KEY_SALT,
 *                              info="2post-api-key-hmac", 32)
 */

export const TOKEN_PREFIX = "2post_";
/// Legacy prefix — keys issued before the rebrand still verify.
const LEGACY_PREFIX = "bb_studio_";
const LOOKUP_LEN = 8;

export interface ParsedToken {
  randomPart: string;
  lookupPrefix: string;
}

function hmacPepper(): Buffer {
  const secret = process.env.SECRET_KEY;
  const salt = process.env.ENCRYPTION_KEY_SALT;
  if (!secret || !salt) {
    throw new Error("ENCRYPTION_KEY_SALT must be set for ApiKey HMAC peppering.");
  }
  return Buffer.from(
    hkdfSync("sha256", secret, salt, "2post-api-key-hmac", 32),
  );
}

export function hmacHex(randomPart: string): string {
  return createHmac("sha256", hmacPepper()).update(randomPart).digest("hex");
}

export function makeLookup(randomPart: string): string {
  return createHash("sha256").update(randomPart).digest("hex").slice(0, LOOKUP_LEN);
}

/** Split a raw bearer token; null when malformed (strict legacy rules). */
export function parseToken(raw: string | undefined | null): ParsedToken | null {
  if (!raw) return null;
  let body: string;
  if (raw.startsWith(TOKEN_PREFIX)) {
    body = raw.slice(TOKEN_PREFIX.length);
  } else if (raw.startsWith(LEGACY_PREFIX)) {
    body = raw.slice(LEGACY_PREFIX.length);
  } else {
    return null;
  }
  // The secret may contain underscores — split on the LAST one only.
  const idx = body.lastIndexOf("_");
  if (idx <= 0) return null;
  const randomPart = body.slice(0, idx);
  const lookup = body.slice(idx + 1);
  if (lookup.length !== LOOKUP_LEN) return null;
  if (randomPart.length < 20) return null;
  return { randomPart, lookupPrefix: lookup };
}

/** Issues a full key: returns the raw secret once and the stored parts. */
export function issueApiKey(): {
  raw: string;
  lookupPrefix: string;
  tokenHash: string;
} {
  const randomPart = randomBytes(32).toString("base64url");
  const raw = `${TOKEN_PREFIX}${randomPart}_${makeLookup(randomPart)}`;
  return { raw, lookupPrefix: makeLookup(randomPart), tokenHash: hmacHex(randomPart) };
}

/** Constant-time verification of a bearer against a stored hash. */
export function verifyToken(rawBearer: string, storedHash: string): boolean {
  const parsed = parseToken(rawBearer);
  if (!parsed) return false;
  const computed = hmacHex(parsed.randomPart);
  if (computed.length !== storedHash.length) return false;
  try {
    return timingSafeEqualHex(computed, storedHash);
  } catch {
    return false;
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i]! ^ bufB[i]!;
  return diff === 0;
}
