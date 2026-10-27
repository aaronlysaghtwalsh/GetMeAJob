import type { Database } from '../db/database';
import { newId, nowIso } from '../lib/ids';

export type AuditAction =
  | 'auth.signup'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.password_changed'
  | 'document.uploaded'
  | 'document.deleted'
  | 'document.downloaded'
  | 'brain.built'
  | 'brain.item_changed'
  | 'settings.updated'
  | 'settings.api_key_set'
  | 'settings.api_key_removed'
  | 'application.created'
  | 'application.deleted'
  | 'application.stage_changed'
  | 'artifact.approved'
  | 'artifact.exported'
  | 'account.exported'
  | 'account.deleted';

export function audit(
  db: Database,
  entry: { userId: string | null; action: AuditAction; targetType?: string; targetId?: string; meta?: Record<string, unknown>; ip?: string },
): void {
  db.run(`INSERT INTO audit_log (id, user_id, action, target_type, target_id, meta, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    newId('aud'),
    entry.userId,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    JSON.stringify(entry.meta ?? {}),
    entry.ip ?? null,
    nowIso(),
  ]);
}
