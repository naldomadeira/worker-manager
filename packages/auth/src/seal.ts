import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM with a key derived from the configured secret. GCM authenticates as well as
 * encrypts, so a tampered or foreign cookie fails to open instead of being trusted, and the
 * claims inside (including the refresh token) are never readable client side.
 */
export class Sealer {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret) throw new Error('@worker-manager/auth: the session secret must not be empty.');
    this.key = Buffer.from(
      hkdfSync('sha256', secret, 'worker-manager-auth', 'session-cookie-v1', 32)
    );
  }

  seal(value: unknown): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);

    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  unseal<T>(token: string | undefined): T | null {
    if (!token) return null;
    try {
      const raw = Buffer.from(token, 'base64url');
      if (raw.length <= IV_BYTES + TAG_BYTES) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      const plain = Buffer.concat([
        decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]);

      return JSON.parse(plain.toString('utf8')) as T;
    } catch {
      return null;
    }
  }
}
