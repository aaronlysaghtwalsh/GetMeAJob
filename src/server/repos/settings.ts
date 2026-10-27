import { z } from 'zod/v4';
import type { Database } from '../db/database';
import { parseJson } from '../db/database';
import { decryptJson, encryptJson } from '../security/crypto';
import { nowIso } from '../lib/ids';

export const ProviderChoice = z.enum(['anthropic', 'openai', 'openai_compatible']);

export const UserSettingsSchema = z.object({
  provider: ProviderChoice.default('anthropic'),
  models: z
    .object({
      extraction: z.string().max(120).default(''),
      reasoning: z.string().max(120).default(''),
      writing: z.string().max(120).default(''),
      research: z.string().max(120).default(''),
    })
    .default({ extraction: '', reasoning: '', writing: '', research: '' }),
  compatibleBaseUrl: z.string().max(300).default(''),
  researchDepth: z.enum(['standard', 'deep', 'maximum']).default('deep'),
  researchLocation: z.string().max(120).default(''),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export type SecretKey = 'anthropic' | 'openai' | 'openai_compatible';
export type Secrets = Partial<Record<SecretKey, string>>;

export function getSettings(db: Database, userId: string): UserSettings {
  const row = db.one<{ data: string }>('SELECT data FROM user_settings WHERE user_id = ?', [userId]);
  return UserSettingsSchema.parse(parseJson(row?.data, {}));
}

export function saveSettings(db: Database, userId: string, settings: UserSettings): void {
  db.run(
    `INSERT INTO user_settings (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [userId, JSON.stringify(settings), nowIso()],
  );
}

export function getSecrets(db: Database, userId: string, key: Buffer): Secrets {
  const row = db.one<{ secrets_enc: string | null }>('SELECT secrets_enc FROM user_settings WHERE user_id = ?', [userId]);
  if (!row?.secrets_enc) return {};
  try {
    return decryptJson<Secrets>(row.secrets_enc, key);
  } catch {
    return {};
  }
}

export function saveSecrets(db: Database, userId: string, secrets: Secrets, key: Buffer): void {
  const enc = encryptJson(secrets, key);
  db.run(
    `INSERT INTO user_settings (user_id, data, secrets_enc, updated_at) VALUES (?, '{}', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET secrets_enc = excluded.secrets_enc, updated_at = excluded.updated_at`,
    [userId, enc, nowIso()],
  );
}

export function maskKey(k: string | undefined): string | null {
  if (!k) return null;
  return k.length <= 8 ? '••••' : `${k.slice(0, 7)}…${k.slice(-4)}`;
}
