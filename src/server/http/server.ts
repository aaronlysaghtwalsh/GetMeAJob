import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
// Use Node's web-stream classes so their types match what Readable.toWeb() returns
// (the DOM lib's TransformStream type is not assignable to Node's ReadableStream.pipeThrough).
import { TransformStream } from 'node:stream/web';
import { ZodError } from 'zod/v4';
import type { App } from '../app';
import { HttpError, json, type Ctx } from './core';
import type { Router } from './router';
import { parseCookies, SESSION_COOKIE } from './cookies';

const MAX_BODY_BYTES = 30 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

function clientIp(req: http.IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

function toWebRequest(req: http.IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  const method = req.method ?? 'GET';
  const hasBody = !['GET', 'HEAD'].includes(method);
  let received = 0;
  const limited = hasBody
    ? Readable.toWeb(req).pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > MAX_BODY_BYTES) {
              controller.error(new HttpError(413, 'too_large', 'Request body is too large.'));
              return;
            }
            controller.enqueue(chunk);
          },
        }),
      )
    : undefined;
  return new Request(url, { method, headers, body: limited as ReadableStream | undefined, duplex: 'half' } as RequestInit);
}

/** CSRF defence for state-changing API calls: same-origin check plus a custom header simple forms cannot send. */
function checkCsrf(req: Request, url: URL): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const site = req.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) throw new HttpError(403, 'csrf', 'Cross-site request blocked.');
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) throw new HttpError(403, 'csrf', 'Cross-origin request blocked.');
  if (req.headers.get('x-gmaj-csrf') !== '1') throw new HttpError(403, 'csrf', 'Missing CSRF header.');
}

async function writeResponse(res: http.ServerResponse, response: Response, extra: Headers, isApi: boolean, method: string) {
  const headers: Record<string, string | string[]> = { ...SECURITY_HEADERS };
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') return;
    headers[key] = value;
  });
  const cookies = [...response.headers.getSetCookie(), ...extra.getSetCookie()];
  extra.forEach((value, key) => {
    if (key !== 'set-cookie') headers[key] = value;
  });
  if (cookies.length) headers['set-cookie'] = cookies;
  if (isApi && !headers['cache-control']) headers['cache-control'] = 'no-store';
  res.writeHead(response.status, headers);
  if (!response.body || method === 'HEAD') {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((r) => res.once('drain', r));
    }
  } finally {
    res.end();
  }
}

function errorResponse(err: unknown, log: (msg: string, e?: unknown) => void): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return json({ error: { code: 'bad_request', message: 'Some fields are invalid.', details: err.issues } }, { status: 400 });
  }
  log('Unhandled error', err);
  return json({ error: { code: 'internal', message: 'Something went wrong on our side. The error has been logged.' } }, { status: 500 });
}

function serveStatic(app: App, url: URL, res: http.ServerResponse, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const root = app.config.clientDir;
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return false; // malformed escape sequence: treated as not found
  }
  if (rel.includes('\0')) return false;
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(path.normalize(root + path.sep))) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(rel)) return false;
    return false;
  }
  const ext = path.extname(file);
  const immutable = /\/assets\/app-[0-9a-f]{10}\./.test(rel) || rel.startsWith('/fonts/');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

export function createHttpServer(app: App, router: Router): http.Server {
  const log = app.log;
  // Safety net: no request can crash the process, whatever fails inside the handler.
  return http.createServer((nreq, nres) => {
    handle(nreq, nres).catch((err) => {
      log('Request failed', err);
      try {
        if (!nres.headersSent) nres.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'text/plain' });
        nres.end();
      } catch {
        nres.destroy();
      }
    });
  });

  async function handle(nreq: http.IncomingMessage, nres: http.ServerResponse): Promise<void> {
    const started = Date.now();
    const method = nreq.method ?? 'GET';
    const host = nreq.headers.host ?? `${app.config.host}:${app.config.port}`;
    let url: URL;
    try {
      url = new URL(nreq.url ?? '/', `http://${host}`);
    } catch {
      nres.writeHead(400).end();
      return;
    }
    const isApi = url.pathname.startsWith('/api/');
    if (!isApi) {
      if (serveStatic(app, url, nres, method)) return;
      nres.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain' }).end('Not found');
      return;
    }

    const req = toWebRequest(nreq, url);
    const cookies = parseCookies(req.headers.get('cookie'));
    const ctx: Ctx = {
      app,
      req,
      url,
      params: {},
      ip: clientIp(nreq),
      cookies,
      user: null,
      sessionId: null,
      extraHeaders: new Headers(),
    };

    let response: Response;
    try {
      checkCsrf(req, url);
      const match = router.match(method, url.pathname);
      if (match.kind === 'none') throw new HttpError(404, 'not_found', 'Unknown API route.');
      if (match.kind === 'method_not_allowed') throw new HttpError(405, 'method_not_allowed', `Use ${match.allowed.join(', ')}.`);
      ctx.params = match.params;
      const token = cookies[SESSION_COOKIE];
      if (token) {
        const resolved = app.sessions.resolve(token, ctx);
        if (resolved) {
          ctx.user = resolved.user;
          ctx.sessionId = resolved.sessionId;
        }
      }
      if (match.options.auth && !ctx.user) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
      response = await match.handler(ctx);
    } catch (err) {
      response = errorResponse(err, log);
    }
    try {
      await writeResponse(nres, response, ctx.extraHeaders, isApi, method);
    } catch (err) {
      log('Failed writing response', err);
      if (!nres.headersSent) nres.writeHead(500);
      nres.end();
    }
    if (app.config.env === 'development') {
      app.log(`${method} ${url.pathname} ${response.status} ${Date.now() - started}ms`);
    }
  }
}
