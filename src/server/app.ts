import type { Config } from './config';
import { Database } from './db/database';
import { deriveKey } from './security/crypto';
import { SessionService } from './security/sessions';
import { RateLimiter } from './security/rate-limit';
import { FileStorage } from './services/storage';
import { AIService } from './ai/service';
import { TaskQueue } from './tasks/queue';

export interface App {
  config: Config;
  db: Database;
  keys: { files: Buffer; secrets: Buffer };
  log: (msg: string, err?: unknown) => void;
  sessions: SessionService;
  storage: FileStorage;
  ai: AIService;
  tasks: TaskQueue;
  limits: { login: RateLimiter; signup: RateLimiter; aiStart: RateLimiter };
}

export function createApp(config: Config): App {
  const db = new Database(config.dbFile);
  db.migrate();
  const keys = { files: deriveKey(config.appSecret, 'file-storage'), secrets: deriveKey(config.appSecret, 'user-secrets') };
  const log = (msg: string, err?: unknown) => {
    if (config.env === 'test' && !process.env.GMAJ_DEBUG) return;
    const stamp = new Date().toISOString().slice(11, 19);
    if (err) console.error(`[${stamp}] ${msg}:`, err instanceof Error ? (err.stack ?? err.message) : err);
    else console.log(`[${stamp}] ${msg}`);
  };
  const app = {
    config,
    db,
    keys,
    log,
    sessions: new SessionService(db, config.secureCookies),
    storage: new FileStorage(config.storageDir, keys.files),
    limits: {
      login: new RateLimiter(10, 15 * 60_000),
      signup: new RateLimiter(5, 60 * 60_000),
      aiStart: new RateLimiter(60, 60 * 60_000),
    },
  } as App;
  app.ai = new AIService(app);
  app.tasks = new TaskQueue(app, Number(process.env.TASK_CONCURRENCY || 2));
  return app;
}
