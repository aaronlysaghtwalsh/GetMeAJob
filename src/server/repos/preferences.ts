import type { Database } from '../db/database';
import { parseJson } from '../db/database';
import { nowIso } from '../lib/ids';
import { PreferencesSchema, type Preferences } from '../../shared/schemas/brain';

export function getPreferences(db: Database, userId: string): Preferences {
  const row = db.one<{ data: string }>('SELECT data FROM preferences WHERE user_id = ?', [userId]);
  const parsed = PreferencesSchema.safeParse(parseJson(row?.data, {}));
  return parsed.success ? parsed.data : PreferencesSchema.parse({});
}

export function savePreferences(db: Database, userId: string, prefs: Preferences): void {
  db.run(
    `INSERT INTO preferences (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [userId, JSON.stringify(prefs), nowIso()],
  );
}
