import { describe, expect, it } from "vitest";

import { CryptoService } from "./crypto.service";

const FIXTURE_SECRET_KEY = "test-secret-key-migration-fixture";
const FIXTURE_SALT = "test-salt-migration-fixture";

/**
 * Ciphertext produced by the legacy Django implementation
 * (apps/common/encryption.py) with the env vars above:
 *   SECRET_KEY=... ENCRYPTION_KEY_SALT=... python -c "
 *     from apps.common.encryption import encrypt_value
 *     print(encrypt_value('brightbean-cross-compat-vector'))"
 *
 * If this test breaks, every stored OAuth token/credential breaks at cutover.
 */
const PYTHON_CIPHERTEXT =
  "GKuCy/JYojI4AuCTdlQuJ8loeMRyZ4Nrnw6V6awXyTmH0rCQSDDR87FPGIUxJlrpplttazF6Rm8ZWg==";
const PLAINTEXT = "brightbean-cross-compat-vector";

function makeService(): CryptoService {
  process.env.SECRET_KEY = FIXTURE_SECRET_KEY;
  process.env.ENCRYPTION_KEY_SALT = FIXTURE_SALT;
  return new CryptoService();
}

describe("CryptoService (byte-compat with apps/common/encryption.py)", () => {
  it("decrypts a ciphertext produced by the legacy Python implementation", () => {
    expect(makeService().decrypt(PYTHON_CIPHERTEXT)).toBe(PLAINTEXT);
  });

  it("round-trips plaintext through encrypt → decrypt", () => {
    const service = makeService();
    const value = "oauth-token-abc123-ñ-🔐";
    expect(service.decrypt(service.encrypt(value))).toBe(value);
  });

  it("produces a different ciphertext per call (random nonce)", () => {
    const service = makeService();
    expect(service.encrypt(PLAINTEXT)).not.toBe(service.encrypt(PLAINTEXT));
  });

  it("rejects tampered ciphertext", () => {
    const service = makeService();
    const raw = Buffer.from(PYTHON_CIPHERTEXT, "base64");
    raw[20] = raw[20]! ^ 0xff;
    expect(() => service.decrypt(raw.toString("base64"))).toThrow(
      "Decryption failed - possibly wrong SECRET_KEY or corrupted data",
    );
  });
});
