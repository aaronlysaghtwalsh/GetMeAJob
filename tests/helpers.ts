import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import { loadConfig } from '../src/server/config';
import { createApp, type App } from '../src/server/app';
import { registerTaskHandlers } from '../src/server/tasks/handlers';
import { buildRouter } from '../src/server/routes';
import { createHttpServer } from '../src/server/http/server';
import { registerFixtures } from './fixtures/scripted';

export interface TestServer {
  app: App;
  url: string;
  close: () => Promise<void>;
}

export async function startTestServer(opts: { signupMode?: 'first-user' | 'open' } = {}): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmaj-test-'));
  const config = loadConfig({
    env: 'test',
    dataDir: dir,
    dbFile: path.join(dir, 'test.db'),
    storageDir: path.join(dir, 'storage'),
    appSecret: crypto.randomBytes(32),
    forcedProvider: 'scripted',
    signupMode: opts.signupMode ?? 'open',
    allowOutboundFetch: false,
    secureCookies: false,
  });
  const app = createApp(config);
  registerTaskHandlers(app);
  registerFixtures(app.ai.scriptedProvider);
  app.tasks.start();
  const server = createHttpServer(app, buildRouter());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await app.tasks.stop();
      await new Promise<void>((r) => server.close(() => r()));
      app.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Minimal API client with a cookie jar, mirroring what the browser app sends. */
export class Client {
  cookie = '';
  constructor(readonly base: string) {}

  async req<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; headers: Headers; raw: Response }> {
    const headers: Record<string, string> = { 'x-gmaj-csrf': '1' };
    if (this.cookie) headers.cookie = this.cookie;
    let payload: any;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const resp = await fetch(this.base + path, { method, headers, body: payload });
    const setCookie = resp.headers.getSetCookie();
    for (const c of setCookie) {
      const [pair] = c.split(';');
      if (pair.startsWith('gmaj_session=')) this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const type = resp.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await resp.json() : ((await resp.arrayBuffer()) as any);
    return { status: resp.status, data, headers: resp.headers, raw: resp };
  }
  get<T = any>(p: string) {
    return this.req<T>('GET', p);
  }
  post<T = any>(p: string, b: unknown = {}) {
    return this.req<T>('POST', p, b);
  }
  put<T = any>(p: string, b: unknown = {}) {
    return this.req<T>('PUT', p, b);
  }
  patch<T = any>(p: string, b: unknown = {}) {
    return this.req<T>('PATCH', p, b);
  }
  del<T = any>(p: string) {
    return this.req<T>('DELETE', p);
  }

  async waitTask(id: string, timeoutMs = 30_000): Promise<any> {
    const start = Date.now();
    for (;;) {
      const r = await this.get(`/api/tasks/${id}`);
      if (['succeeded', 'failed', 'canceled'].includes(r.data.status)) return r.data;
      if (Date.now() - start > timeoutMs) throw new Error(`Task ${id} timed out: ${JSON.stringify(r.data.progress)}`);
      await new Promise((res) => setTimeout(res, 50));
    }
  }
}
