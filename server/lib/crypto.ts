import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';
import { HttpError } from './http';

function key(): Buffer {
  const raw = env().encryptionKey;
  if (!raw) {
    throw new HttpError(500, 'server_misconfigured', 'PROJECTLENS_ENCRYPTION_KEY is required to store repository tokens');
  }
  // Accept a base64 32-byte key, or derive one from any passphrase.
  const decoded = Buffer.from(raw, 'base64');
  return decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest();
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hmac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function newApiKey(): { key: string; prefix: string; hash: string } {
  const key = `plk_${randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, 10), hash: sha256(key) };
}
