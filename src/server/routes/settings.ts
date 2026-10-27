import { z } from 'zod/v4';
import JSZip from 'jszip';
import type { Router } from '../http/router';
import { badRequest, json, readJson, requireUser, unauthorized } from '../http/core';
import { getSecrets, getSettings, maskKey, saveSecrets, saveSettings, UserSettingsSchema, ProviderChoice } from '../repos/settings';
import { MODEL_ROLE_LABEL, SUGGESTED_MODELS, DEFAULT_MODELS } from '../ai/registry';
import { audit } from '../security/audit';
import { verifyPassword } from '../security/passwords';
import { parseJson } from '../db/database';

const USER_TABLES = [
  'profiles',
  'preferences',
  'documents',
  'experiences',
  'education',
  'projects',
  'evidence',
  'skills',
  'resume_sources',
  'discovery_questions',
  'companies',
  'jobs',
  'applications',
  'application_questions',
  'artifacts',
  'application_events',
  'contacts',
  'notes',
  'ai_runs',
  'feedback',
  'audit_log',
] as const;

export function settingsRoutes(r: Router) {
  r.get('/api/settings/ai', (ctx) => {
    const user = requireUser(ctx);
    const settings = getSettings(ctx.app.db, user.id);
    const secrets = getSecrets(ctx.app.db, user.id, ctx.app.keys.secrets);
    const status = ctx.app.ai.status(user.id);
    return json({
      ...status,
      settings,
      keys: {
        anthropic: maskKey(secrets.anthropic),
        openai: maskKey(secrets.openai),
        openai_compatible: maskKey(secrets.openai_compatible),
      },
      envKeys: { anthropic: !!ctx.app.config.env_keys.anthropic, openai: !!ctx.app.config.env_keys.openai },
      roles: MODEL_ROLE_LABEL,
      suggestedModels: SUGGESTED_MODELS,
      defaultModels: DEFAULT_MODELS,
    });
  });

  r.put('/api/settings/ai', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx, UserSettingsSchema);
    if (body.compatibleBaseUrl && !/^https?:\/\//.test(body.compatibleBaseUrl)) throw badRequest('Base URL must start with http:// or https://');
    saveSettings(ctx.app.db, user.id, body);
    audit(ctx.app.db, { userId: user.id, action: 'settings.updated', meta: { provider: body.provider } });
    return json({ ok: true });
  });

  r.put('/api/settings/ai/key', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx, z.object({ provider: ProviderChoice, key: z.string().trim().min(8).max(400) }));
    if (body.provider === 'anthropic' && !body.key.startsWith('sk-ant-')) throw badRequest('Anthropic API keys start with "sk-ant-".');
    const secrets = getSecrets(ctx.app.db, user.id, ctx.app.keys.secrets);
    secrets[body.provider] = body.key;
    saveSecrets(ctx.app.db, user.id, secrets, ctx.app.keys.secrets);
    audit(ctx.app.db, { userId: user.id, action: 'settings.api_key_set', meta: { provider: body.provider } });
    return json({ ok: true, masked: maskKey(body.key) });
  });

  r.delete('/api/settings/ai/key/:provider', (ctx) => {
    const user = requireUser(ctx);
    const provider = ProviderChoice.parse(ctx.params.provider);
    const secrets = getSecrets(ctx.app.db, user.id, ctx.app.keys.secrets);
    delete secrets[provider];
    saveSecrets(ctx.app.db, user.id, secrets, ctx.app.keys.secrets);
    audit(ctx.app.db, { userId: user.id, action: 'settings.api_key_removed', meta: { provider } });
    return json({ ok: true });
  });

  r.post('/api/settings/ai/test', async (ctx) => {
    const user = requireUser(ctx);
    try {
      return json(await ctx.app.ai.test(user.id));
    } catch (err) {
      return json({ ok: false, model: '', message: (err as Error).message });
    }
  });

  r.get('/api/settings/usage', (ctx) => {
    const user = requireUser(ctx);
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const totals = ctx.app.db.one<Record<string, number>>(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output, COALESCE(SUM(web_searches),0) AS searches,
              COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END),0) AS errors
       FROM ai_runs WHERE user_id = ? AND created_at >= ?`,
      [user.id, since],
    );
    const recent = ctx.app.db.all(
      `SELECT purpose, provider, model, input_tokens, output_tokens, web_searches, cost_usd, duration_ms, status, error, created_at FROM ai_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`,
      [user.id],
    );
    return json({ totals, recent });
  });

  r.get('/api/settings/audit', (ctx) => {
    const user = requireUser(ctx);
    const rows = ctx.app.db.all<Record<string, any>>(`SELECT action, target_type, target_id, meta, ip, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`, [user.id]);
    return json({ entries: rows.map((r) => ({ ...r, meta: parseJson(r.meta, {}) })) });
  });

  /* Privacy: export and deletion ------------------------------------------------------------------------- */

  r.get('/api/account/export', async (ctx) => {
    const user = requireUser(ctx);
    const zip = new JSZip();
    const data: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      format: 'getmeajob-export/v1',
      account: ctx.app.db.one('SELECT id, email, display_name, plan, created_at, last_login_at FROM users WHERE id = ?', [user.id]),
      settings: getSettings(ctx.app.db, user.id),
    };
    for (const table of USER_TABLES) {
      const rows = ctx.app.db.all<Record<string, any>>(`SELECT * FROM ${table} WHERE user_id = ?`, [user.id]);
      data[table] = rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          if (k === 'storage_key' || k === 'user_id') continue;
          out[k] = typeof v === 'string' && /^[[{]/.test(v) ? parseJson(v, v) : v;
        }
        return out;
      });
    }
    zip.file('getmeajob-data.json', JSON.stringify(data, null, 2));
    const docs = ctx.app.db.all<{ id: string; filename: string; storage_key: string }>('SELECT id, filename, storage_key FROM documents WHERE user_id = ?', [user.id]);
    for (const d of docs) {
      try {
        zip.file(`documents/${d.id}-${d.filename}`, await ctx.app.storage.get(user.id, d.storage_key));
      } catch {
        /* missing file: skip */
      }
    }
    zip.file(
      'README.txt',
      'This archive contains everything GetMeAJob stores about your account: getmeajob-data.json (all records, AI outputs and history) and your original uploaded documents. API keys and your password hash are not included.\n',
    );
    const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    audit(ctx.app.db, { userId: user.id, action: 'account.exported', ip: ctx.ip });
    return new Response(buf as unknown as ConstructorParameters<typeof Response>[0], {
      headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="getmeajob-export-${new Date().toISOString().slice(0, 10)}.zip"` },
    });
  });

  r.post('/api/account/delete', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx, z.object({ password: z.string().min(1).max(200), confirm: z.literal('DELETE') }));
    const row = ctx.app.db.one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!row || !(await verifyPassword(body.password, row.password_hash))) throw unauthorized('Password is incorrect.');
    for (const t of ctx.app.tasks.active(user.id)) ctx.app.tasks.cancel(user.id, t.id);
    ctx.app.db.run('DELETE FROM users WHERE id = ?', [user.id]);
    await ctx.app.storage.deleteUser(user.id);
    audit(ctx.app.db, { userId: null, action: 'account.deleted', meta: { userId: user.id }, ip: ctx.ip });
    if (ctx.sessionId) ctx.app.sessions.destroy(ctx.sessionId, ctx);
    return json({ ok: true });
  });
}
