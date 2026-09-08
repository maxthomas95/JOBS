import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createCodexRouter } from '../server/codex-receiver.ts';

test('synthetic diagnostics verify routing without agent creation; provider health contains only safe metadata', async t => {
  let registrations = 0, events = 0;
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(createCodexRouter({
    registerWebhookAgent(sourceId) { registrations++; return { id: `wh:${sourceId}` }; },
    handleEvent() { events++; },
  }));
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/codex/hooks', { diagnostic: 'jobs-delivery-check-v1' })).status, 200);
  assert.equal(registrations, 0);
  assert.equal(events, 0);
  const before = await (await fetch(url + '/api/providers')).json();
  assert.equal(before.providers[0].mode, 'unobserved');
  assert.equal(typeof before.providers[0].lastCheckAt, 'number');
  assert.equal((await post('/api/codex/hooks', { hook_event_name: 'Stop', session_id: 'test' })).status, 400);
  assert.equal((await post('/api/codex/notify', { type: 'future-event', 'thread-id': 'test' })).status, 200);
  assert.equal(events, 0);
  await post('/api/codex/hooks', { hook_event_name: 'UserPromptSubmit', session_id: 'test', turn_id: 'turn-one', prompt: 'PRIVATE_MARKER', cwd: '/PRIVATE_PATH' });
  const health = await (await fetch(url + '/api/providers')).json();
  assert.equal(health.providers[0].mode, 'hooks');
  assert.equal(health.providers[0].acceptedEvents, 1);
  assert.doesNotMatch(JSON.stringify(health), /PRIVATE_/);
});
