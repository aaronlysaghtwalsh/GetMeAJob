import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type SignupMode = 'first-user' | 'open' | 'closed';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  dataDir: string;
  dbFile: string;
  storageDir: string;
  clientDir: string;
  secureCookies: boolean;
  signupMode: SignupMode;
  appSecret: Buffer;
  env_keys: { anthropic?: string; openai?: string; openaiBaseUrl?: string };
  /** Force a specific AI provider (used by tests: 'scripted'). */
  forcedProvider?: string;
  /** Allow server-side fetching of job URLs (disabled in tests). */
  allowOutboundFetch: boolean;
}

/** Minimal .env loader (KEY=VALUE per line, # comments). Existing env vars win. */
export function loadDotEnv(file = path.resolve(process.cwd(), '.env')): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function loadOrCreateSecret(dataDir: string): Buffer {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv) {
    const buf = /^[0-9a-f]{64,}$/i.test(fromEnv) ? Buffer.from(fromEnv, 'hex') : Buffer.from(fromEnv, 'base64');
    if (buf.length < 32) throw new Error('APP_SECRET must decode to at least 32 bytes (use 64 hex chars).');
    return buf;
  }
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  fs.mkdirSync(dataDir, { recursive: true });
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(file, secret.toString('hex'), { mode: 0o600 });
  return secret;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  loadDotEnv();
  const env = (process.env.NODE_ENV as Config['env']) || 'development';
  const dataDir = overrides.dataDir ?? path.resolve(process.env.DATA_DIR || 'data');
  const signup = (process.env.SIGNUP_MODE as SignupMode) || 'first-user';
  const config: Config = {
    env,
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || '127.0.0.1',
    dataDir,
    dbFile: path.join(dataDir, 'getmeajob.db'),
    storageDir: path.join(dataDir, 'storage'),
    clientDir: path.resolve(process.env.CLIENT_DIR || 'dist/client'),
    secureCookies: process.env.SECURE_COOKIES ? process.env.SECURE_COOKIES === 'true' : env === 'production' && process.env.HOST !== '127.0.0.1',
    signupMode: ['first-user', 'open', 'closed'].includes(signup) ? signup : 'first-user',
    appSecret: Buffer.alloc(0),
    env_keys: {
      anthropic: process.env.ANTHROPIC_API_KEY || undefined,
      openai: process.env.OPENAI_API_KEY || undefined,
      openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
    },
    allowOutboundFetch: process.env.ALLOW_OUTBOUND_FETCH !== 'false',
    ...overrides,
  };
  if (!config.appSecret.length) config.appSecret = loadOrCreateSecret(config.dataDir);
  config.dbFile = overrides.dbFile ?? path.join(config.dataDir, 'getmeajob.db');
  config.storageDir = overrides.storageDir ?? path.join(config.dataDir, 'storage');
  return config;
}
