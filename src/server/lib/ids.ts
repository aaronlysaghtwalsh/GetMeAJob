import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Prefixed, URL-safe random id, e.g. evd_4fK9x2LmQ0aZ1bCd (~95 bits of entropy). */
export function newId(prefix: string): string {
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] % 62];
  return `${prefix}_${out}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
