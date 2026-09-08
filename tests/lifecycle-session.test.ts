import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionManager } from '../server/session-manager.js';

test('snapshots contain only public fields and detach nested state', (t) => {
  const manager = new SessionManager();
  t.after(() => manager.dispose());
  const internal = manager.registerSession('safe-session', 'C:/Users/PRIVATE/.claude/projects/C--repo-fixture/safe-session.jsonl');
  Object.assign(internal, { internalSecret: 'PRIVATE' });
  const [publicAgent] = manager.getSnapshot();
  assert.ok(!JSON.stringify(publicAgent).includes('PRIVATE'));
  assert.ok(!('filePath' in publicAgent));
  assert.ok(!('internalSecret' in publicAgent));
  assert.ok(publicAgent.startedAt);
  publicAgent.childIds.push('mutation');
  publicAgent.position.x = -100;
  assert.deepEqual(internal.childIds, []);
  assert.notEqual(internal.position.x, -100);
});

test('webhook stop, resume, and repeated start do not delete the resumed agent', async (t) => {
  const manager = new SessionManager();
  t.after(() => manager.dispose());
  const original = manager.registerWebhookAgent('codex-fixture', { sourceType: 'codex', state: 'waiting' });
  assert.equal(original.waitingForHuman, true);
  manager.removeWebhookAgent(original.id);
  manager.removeWebhookAgent(original.id);
  manager.updateWebhookAgent(original.id, 'running', null, null);
  const repeated = manager.registerWebhookAgent('codex-fixture', { state: 'running' });
  assert.equal(repeated, original);
  assert.equal(repeated.state, 'coding');
  assert.equal(repeated.waitingForHuman, false);
  await delay(2100);
  assert.equal(manager.hasSession(original.id), true);
  assert.equal(manager.getMachines()[0].activeCount, 1);
  manager.removeSession(original.id);
  assert.equal(manager.getMachines()[0].activeCount, 0);
});

test('session events resume leaving agents and hooks expose canonical attention and linking', async (t) => {
  const manager = new SessionManager();
  t.after(() => manager.dispose());
  const child = manager.registerWebhookAgent('codex-child', { sourceType: 'codex', integrationMode: 'hooks', parentId: 'wh:codex-parent' });
  const parent = manager.registerWebhookAgent('codex-parent', { sourceType: 'codex', integrationMode: 'hooks' });
  assert.deepEqual(parent.childIds, [child.id]);
  const timestamp = Date.now();
  manager.handleEvent({ id: 'ended', sessionId: child.id, timestamp, type: 'session', action: 'ended' });
  manager.handleEvent({ id: 'resumed', sessionId: child.id, timestamp: timestamp + 1, type: 'activity', action: 'user_prompt' });
  manager.handleEvent({ id: 'approval', sessionId: child.id, timestamp: timestamp + 2, type: 'activity', action: 'needsApproval' });
  assert.equal(child.state, 'needsApproval');
  assert.equal(child.waitingForHuman, true);
  manager.handleEvent({ id: 'tool', sessionId: child.id, timestamp: timestamp + 3, type: 'tool', tool: 'Read', status: 'started', toolUseId: 'fixture' });
  assert.equal(child.waitingForHuman, false);
  assert.equal(child.state, 'reading');
  manager.handleEvent({ id: 'tool', sessionId: child.id, timestamp: timestamp + 3, type: 'tool', tool: 'Write', status: 'started' });
  assert.equal(child.state, 'reading', 'repeated event IDs are idempotent');
  await delay(2100);
  assert.equal(manager.hasSession(child.id), true);
});
