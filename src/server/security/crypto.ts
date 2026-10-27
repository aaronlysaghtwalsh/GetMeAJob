import crypto from 'node:crypto';

/**
 * Envelope format for encrypted blobs: [version=1][iv:12][tag:16][ciphertext]. AES-256-GCM.
 * Keys are derived per purpose from the app secret with HKDF so a leak of one derived key
 * does not expose the others.
 */
const VERSION = 1;

export function deriveKey(secret: Buffer, purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.from('getmeajob/v1'), Buffer.from(purpose), 32));
}

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < 29 || blob[0] !== VERSION) throw new Error('Unsupported or corrupt encrypted blob');
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]);
}

export function encryptJson(value: unknown, key: Buffer): string {
  return encrypt(Buffer.from(JSON.stringify(value), 'utf8'), key).toString('base64');
}

export function decryptJson<T>(text: string, key: Buffer): T {
  return JSON.parse(decrypt(Buffer.from(text, 'base64'), key).toString('utf8')) as T;
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
