import type { Database } from '../db/database';
import type { AuthUser, Ctx } from '../http/core';
import { SESSION_COOKIE, serializeCookie } from '../http/cookies';
import { randomToken, sha256Hex } from './crypto';

const SESSION_DAYS = 30;
const RENEW_AFTER_MS = 12 * 60 * 60 * 1000;

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  last_seen_at: string;
  email: string;
  display_name: string;
  plan: string;
}

/**
 * Server-side sessions. The cookie holds a random 256-bit token; the database stores only its
 * SHA-256 hash, so a database leak does not yield usable session tokens.
 */
export class SessionService {
  constructor(
    private db: Database,
    private secureCookies: boolean,
  ) {}

  create(userId: string, ctx: Ctx): string {
    const token = randomToken(32);
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
    this.db.run(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sha256Hex(token), userId, now.toISOString(), now.toISOString(), expires.toISOString(), ctx.ip, (ctx.req.headers.get('user-agent') ?? '').slice(0, 300)],
    );
    ctx.extraHeaders.append('set-cookie', serializeCookie(SESSION_COOKIE, token, { secure: this.secureCookies, maxAgeSeconds: SESSION_DAYS * 86400 }));
    return token;
  }

  resolve(token: string, ctx: Ctx): { user: AuthUser; sessionId: string } | null {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const id = sha256Hex(token);
    const row = this.db.one<SessionRow>(
      `SELECT s.id, s.user_id, s.expires_at, s.last_seen_at, u.email, u.display_name, u.plan
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      [id],
    );
    if (!row) return null;
    const now = Date.now();
    if (Date.parse(row.expires_at) <= now) {
      this.db.run('DELETE FROM sessions WHERE id = ?', [id]);
      return null;
    }
    if (now - Date.parse(row.last_seen_at) > RENEW_AFTER_MS) {
      const expires = new Date(now + SESSION_DAYS * 86400_000).toISOString();
      this.db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [new Date(now).toISOString(), expires, id]);
      ctx.extraHeaders.append('set-cookie', serializeCookie(SESSION_COOKIE, token, { secure: this.secureCookies, maxAgeSeconds: SESSION_DAYS * 86400 }));
    }
    return { user: { id: row.user_id, email: row.email, displayName: row.display_name, plan: row.plan }, sessionId: id };
  }

  destroy(sessionId: string, ctx: Ctx): void {
    this.db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    ctx.extraHeaders.append('set-cookie', serializeCookie(SESSION_COOKIE, '', { secure: this.secureCookies, maxAgeSeconds: 0 }));
  }

  destroyOthers(userId: string, keepSessionId: string | null): void {
    this.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', [userId, keepSessionId ?? '']);
  }

  purgeExpired(): void {
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
  }
}
