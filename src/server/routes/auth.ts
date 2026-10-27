import { z } from 'zod/v4';
import type { Router } from '../http/router';
import { badRequest, conflict, forbidden, HttpError, json, readJson, requireUser, tooMany, unauthorized } from '../http/core';
import { getDummyHash, hashPassword, passwordProblems, verifyPassword } from '../security/passwords';
import { audit } from '../security/audit';
import { newId, nowIso } from '../lib/ids';
import type { App } from '../app';

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
const Signup = Credentials.extend({ displayName: z.string().trim().max(80).default('') });

function signupAllowed(app: App): boolean {
  const mode = app.config.signupMode;
  if (mode === 'open') return true;
  if (mode === 'closed') return false;
  const count = app.db.one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
  return Number(count) === 0;
}

export function authRoutes(r: Router) {
  r.get(
    '/api/auth/state',
    (ctx) => {
      const hasUsers = Number(ctx.app.db.one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n) > 0;
      return json({ user: ctx.user, signupAllowed: signupAllowed(ctx.app), hasUsers });
    },
    { auth: false },
  );

  r.post(
    '/api/auth/signup',
    async (ctx) => {
      if (!ctx.app.limits.signup.hit(ctx.ip)) throw tooMany();
      const body = await readJson(ctx, Signup);
      if (!signupAllowed(ctx.app)) throw forbidden('Sign-ups are closed on this server. Ask the owner for an account.');
      const problem = passwordProblems(body.password);
      if (problem) throw badRequest(problem, { fieldErrors: { password: [problem] } });
      const existing = ctx.app.db.one('SELECT id FROM users WHERE email_normalized = ?', [body.email]);
      if (existing) throw conflict('An account with this email already exists. Sign in instead.');
      const id = newId('usr');
      const now = nowIso();
      const hash = await hashPassword(body.password);
      ctx.app.db.tx(() => {
        ctx.app.db.run(
          `INSERT INTO users (id, email, email_normalized, password_hash, display_name, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, body.email, body.email, hash, body.displayName, now, now, now],
        );
        // The resume profile (name/contact shown on documents) is filled from uploaded resumes, not the login.
        ctx.app.db.run(`INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)`, [id, now]);
      });
      ctx.app.sessions.create(id, ctx);
      audit(ctx.app.db, { userId: id, action: 'auth.signup', ip: ctx.ip });
      return json({ user: { id, email: body.email, displayName: body.displayName, plan: 'personal' } }, { status: 201 });
    },
    { auth: false },
  );

  r.post(
    '/api/auth/login',
    async (ctx) => {
      const body = await readJson(ctx, Credentials);
      const key = `${ctx.ip}:${body.email}`;
      if (!ctx.app.limits.login.hit(key) || !ctx.app.limits.login.hit(`ip:${ctx.ip}`)) throw tooMany();
      const user = ctx.app.db.one<{ id: string; email: string; display_name: string; plan: string; password_hash: string }>(
        'SELECT id, email, display_name, plan, password_hash FROM users WHERE email_normalized = ?',
        [body.email],
      );
      const ok = await verifyPassword(body.password, user?.password_hash ?? (await getDummyHash()));
      if (!user || !ok) {
        audit(ctx.app.db, { userId: user?.id ?? null, action: 'auth.login_failed', ip: ctx.ip, meta: { email: body.email } });
        throw new HttpError(401, 'invalid_credentials', 'That email and password do not match.');
      }
      ctx.app.limits.login.reset(key);
      ctx.app.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
      ctx.app.sessions.create(user.id, ctx);
      audit(ctx.app.db, { userId: user.id, action: 'auth.login', ip: ctx.ip });
      return json({ user: { id: user.id, email: user.email, displayName: user.display_name, plan: user.plan } });
    },
    { auth: false },
  );

  r.post(
    '/api/auth/logout',
    (ctx) => {
      if (ctx.sessionId) {
        ctx.app.sessions.destroy(ctx.sessionId, ctx);
        if (ctx.user) audit(ctx.app.db, { userId: ctx.user.id, action: 'auth.logout', ip: ctx.ip });
      }
      return json({ ok: true });
    },
    { auth: false },
  );

  r.post('/api/auth/password', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx, z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }));
    if (!ctx.app.limits.login.hit(`pw:${user.id}`)) throw tooMany();
    const row = ctx.app.db.one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) throw unauthorized('Your current password is incorrect.');
    const problem = passwordProblems(body.newPassword);
    if (problem) throw badRequest(problem, { fieldErrors: { newPassword: [problem] } });
    ctx.app.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [await hashPassword(body.newPassword), nowIso(), user.id]);
    ctx.app.sessions.destroyOthers(user.id, ctx.sessionId);
    audit(ctx.app.db, { userId: user.id, action: 'auth.password_changed', ip: ctx.ip });
    return json({ ok: true });
  });
}
