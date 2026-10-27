import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2;

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const N = Number(n);
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N,
    r: Number(r),
    p: Number(p),
    maxmem: 128 * N * Number(r) * 2,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** A precomputed hash used to keep login timing uniform when the email does not exist. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

export function passwordProblems(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'Use at most 200 characters.';
  if (/^(.)\1+$/.test(password)) return 'Avoid a single repeated character.';
  const common = ['password12', 'password123', '1234567890', 'qwertyuiop', 'letmein123', 'iloveyou12'];
  if (common.includes(password.toLowerCase())) return 'This password is too common.';
  return null;
}
