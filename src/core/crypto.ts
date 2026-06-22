import {
  scryptSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

/**
 * Zero-knowledge encryption helpers built on Node's native crypto.
 *
 * Scheme: AES-256-GCM. The key is derived from the password with scrypt
 * over a per-payload random salt. The 16-byte GCM auth tag is appended to
 * the ciphertext, so a wrong password fails authentication on decrypt.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32; // 256-bit
const IV_LEN = 12; // GCM standard nonce length
const SALT_LEN = 16;
const TAG_LEN = 16;

export interface EncryptedPayload {
  /** base64 random salt used for key derivation */
  salt: string;
  /** base64 GCM nonce */
  iv: string;
  /** base64 ciphertext with the GCM auth tag appended */
  ciphertext: string;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN);
}

export function encrypt(plaintext: string, password: string): EncryptedPayload {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: Buffer.concat([encrypted, tag]).toString("base64"),
  };
}

export function decrypt(payload: EncryptedPayload, password: string): string {
  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const data = Buffer.from(payload.ciphertext, "base64");

  if (data.length < TAG_LEN) {
    throw new Error("Ciphertext too short — payload is corrupt.");
  }

  const tag = data.subarray(data.length - TAG_LEN);
  const encrypted = data.subarray(0, data.length - TAG_LEN);
  const key = deriveKey(password, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM auth tag mismatch — wrong password or tampered payload.
    throw new Error("INVALID_PASSWORD");
  }
}
