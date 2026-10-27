export const SESSION_COOKIE = 'gmaj_session';

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  secure: boolean;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict';
  path?: string;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`, `SameSite=${opts.sameSite ?? 'Lax'}`];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`);
  return parts.join('; ');
}
