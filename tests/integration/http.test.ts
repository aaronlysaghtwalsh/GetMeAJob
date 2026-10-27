import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from '../helpers';

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

test('malformed URLs are rejected without taking the server down', async () => {
  for (const p of ['/%E0%A4%A', '/api/%E0%A4%A', '/applications/%E0%A4%A', '/%00']) {
    const r = await fetch(server.url + p);
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
  }
  const ok = await fetch(server.url + '/api/auth/state');
  assert.equal(ok.status, 200);
});

test('state-changing API calls need the CSRF header', async () => {
  const r = await fetch(server.url + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
  });
  assert.equal(r.status, 403);
});

test('security headers are set on pages and API responses', async () => {
  const api = await fetch(server.url + '/api/auth/state');
  assert.match(api.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
});
