import { createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";

/**
 * Verifies both hash families found in the migrated users table:
 *   - "bcrypt_sha256$…" (legacy default hasher BCryptSHA256PasswordHasher)
 *   - "$2a/$2b/…" plain bcrypt (new-stack issued hashes)
 *
 * Legacy algorithm: bcrypt(hex(sha256(password))) — the base64 keeps the
 * "=" padding; bcrypt ignores anything past its 72-byte limit.
 */
export function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return Promise.resolve(false);

  if (storedHash.startsWith("bcrypt_sha256$")) {
    const bcryptToken = storedHash.match(/\$2[abcy]\$\d{2}\$[./A-Za-z0-9]{53}$/)?.[0];
    if (!bcryptToken) return Promise.resolve(false);
    // Django 4.1+ BCryptSHA256PasswordHasher hashes the HEX digest.
    const b64Digest = createHash("sha256").update(password, "utf8").digest("hex");
    return bcrypt.compare(b64Digest, bcryptToken);
  }

  return bcrypt.compare(password, storedHash);
}

/** New-stack hashing: plain bcrypt cost 12. */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
