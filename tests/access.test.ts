import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test, type TestContext } from 'node:test';
import express from 'express';
import WebSocket from 'ws';
import { ViewerAuth, requireBearer } from '../server/auth.js';
import { WSServer } from '../server/ws-server.js';
import type { SessionManager } from '../server/session-manager.js';

async function office(t: TestContext, token: string | null = 'fixture-secret', sessionMs?: number) {
  const auth = new ViewerAuth(token, sessionMs, false);
  const app = express();
  app.use(express.json());
  app.use(auth.router('/office-stream'));
  app.get('/api/stats', auth.requireViewer, (_req, res) => res.json({ count: 3 }));
  app.post('/api/hooks', requireBearer(token), (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  const sessions = { getSnapshot: () => [], getMachines: () => [] } as unknown as SessionManager;
  const ws = new WSServer(server, sessions, '/office-stream', auth);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => {
    ws.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const login = () => fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
  return { base, ws, login };
}

function rejectedSocket(url: string, headers?: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url, { headers });
    client.on('error', () => { /* terminate after rejected upgrade emits an error */ });
    client.once('open', () => { client.terminate(); reject(new Error('Unexpected upgrade')); });
    client.once('unexpected-response', (_req, res) => {
      res.resume(); client.terminate(); resolve(res.statusCode ?? 0);
    });
  });
}

test('protected office exposes configuration but never a credential; query tokens cannot upgrade', async t => {
  const { base } = await office(t);
  const config = await (await fetch(`${base}/api/auth`)).text();
  assert.deepEqual(JSON.parse(config), { required: true, authenticated: false, wsPath: '/office-stream' });
  assert.ok(!config.includes('fixture-secret'));
  assert.equal((await fetch(`${base}/api/stats`)).status, 401);
  assert.equal(await rejectedSocket(`${base.replace('http:', 'ws:')}/office-stream?token=fixture-secret`), 401);
  assert.equal((await fetch(`${base}/api/hooks`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${base}/api/hooks`, { method: 'POST', headers: { Authorization: 'Bearer fixture-secret' } })).status, 200);
});

test('sign-in creates an HttpOnly cookie; logout revokes both API and existing socket access', async t => {
  const { base, ws, login } = await office(t);
  const response = await login();
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.ok(!setCookie.includes('fixture-secret'));
  const Cookie = setCookie.split(';')[0];
  assert.equal((await fetch(`${base}/api/stats`, { headers: { Cookie } })).status, 200);
  const client = new WebSocket(`${base.replace('http:', 'ws:')}/office-stream`, { headers: { Cookie } });
  const first = once(client, 'message');
  const [data] = await first;
  assert.equal(JSON.parse(String(data)).type, 'snapshot');
  assert.equal((await fetch(`${base}/api/hooks`, { method: 'POST', headers: { Cookie } })).status, 401);
  assert.equal((await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/stats`, { headers: { Cookie } })).status, 401);
  const closed = once(client, 'close');
  ws.broadcastSnapshot();
  assert.equal((await closed)[0], 4401);
});

test('cross-origin browser requests are rejected even with a valid credential', async t => {
  const { base, login } = await office(t);
  const Cookie = (await login()).headers.get('set-cookie')!.split(';')[0];
  const Origin = 'https://unrelated.invalid';
  assert.equal((await fetch(`${base}/api/stats`, { headers: { Cookie, Origin } })).status, 401);
  assert.equal(await rejectedSocket(`${base.replace('http:', 'ws:')}/office-stream`, { Cookie, Origin }), 401);
  assert.equal((await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { Origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-secret' }),
  })).status, 403);
});

test('expired viewer session loses access; tokenless loopback use stays simple', async t => {
  const secured = await office(t, 'fixture-secret', -1);
  const Cookie = (await secured.login()).headers.get('set-cookie')!.split(';')[0];
  assert.equal((await fetch(`${secured.base}/api/stats`, { headers: { Cookie } })).status, 401);
  const local = await office(t, null);
  assert.equal((await fetch(`${local.base}/api/stats`)).status, 200);
  assert.equal((await (await fetch(`${local.base}/api/auth`)).json()).authenticated, true);
  assert.equal((await fetch(`${local.base}/api/stats`, { headers: { Origin: 'https://unrelated.invalid' } })).status, 401);
});
