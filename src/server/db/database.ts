import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations';

export type Params = Record<string, unknown> | unknown[];
export type Row = Record<string, unknown>;

/**
 * Thin wrapper over node:sqlite. Synchronous by design: SQLite calls are fast and in-process,
 * and keeping them synchronous makes transactions simple and safe.
 */
export class Database {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA synchronous = NORMAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
  }

  private bind(params?: Params): SQLInputValue[] {
    if (params === undefined) return [];
    if (Array.isArray(params)) return params.map(normalizeValue);
    const out: Record<string, SQLInputValue> = {};
    for (const [k, v] of Object.entries(params)) out[k] = normalizeValue(v);
    return [out as unknown as SQLInputValue];
  }

  one<T = Row>(sql: string, params?: Params): T | undefined {
    return this.raw.prepare(sql).get(...this.bind(params)) as T | undefined;
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    return this.raw.prepare(sql).all(...this.bind(params)) as T[];
  }

  run(sql: string, params?: Params): { changes: number } {
    const r = this.raw.prepare(sql).run(...this.bind(params));
    return { changes: Number(r.changes) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Run fn inside a transaction (nested calls use savepoints). */
  tx<T>(fn: () => T): T {
    const sp = `sp_${this.depth}`;
    if (this.depth === 0) this.raw.exec('BEGIN IMMEDIATE');
    else this.raw.exec(`SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      if (this.depth === 0) this.raw.exec('COMMIT');
      else this.raw.exec(`RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.depth--;
      if (this.depth === 0) this.raw.exec('ROLLBACK');
      else this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  }

  migrate(): number[] {
    this.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    const applied = new Set(this.all<{ id: number }>('SELECT id FROM schema_migrations').map((r) => Number(r.id)));
    const ran: number[] = [];
    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', [m.id, m.name, new Date().toISOString()]);
      });
      ran.push(m.id);
    }
    return ran;
  }

  close(): void {
    this.raw.close();
  }
}

function normalizeValue(v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  // Objects and arrays are stored as JSON text.
  return JSON.stringify(v);
}

/** Parse a JSON text column, falling back to a default on null/invalid content. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
