import { Injectable } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Byte-compatible port of apps/common/encryption.py:
 *   key    = HKDF-SHA256(ikm=SECRET_KEY, salt=ENCRYPTION_KEY_SALT,
 *                        info="brightbean-field-encryption", length=32)
 *   format = base64( nonce[12] || ciphertext || gcm_tag[16] )
 *
 * Ciphertexts written by the legacy Django app MUST decrypt here and vice
 * versa — verified against a Python-generated fixture in crypto.service.spec.ts.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const secretKey = process.env.SECRET_KEY;
    const salt = process.env.ENCRYPTION_KEY_SALT;
    if (!secretKey || !salt) {
      throw new Error(
        "SECRET_KEY and ENCRYPTION_KEY_SALT must be set. Generate a random value for each.",
      );
    }
    this.key = Buffer.from(
      hkdfSync("sha256", secretKey, salt, "brightbean-field-encryption", 32),
    );
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf8")),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString("base64");
  }

  decrypt(encoded: string): string {
    const raw = Buffer.from(encoded, "base64");
    if (raw.length < 12 + 16) {
      throw new Error("Decryption failed - possibly wrong SECRET_KEY or corrupted data");
    }
    const nonce = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const ciphertext = raw.subarray(12, raw.length - 16);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Decryption failed - possibly wrong SECRET_KEY or corrupted data");
    }
  }
}
