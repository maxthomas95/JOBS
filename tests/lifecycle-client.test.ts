import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionManager } from '../server/session-manager.js';
import { useOfficeStore } from '../src/state/useOfficeStore.js';

test('snapshots reconcile histories, selection, focus, follow, and owned tool timers', (t) => {
  const manager = new SessionManager();
  t.after(() => { manager.dispose(); useOfficeStore.getState().clearAgents(); });
  const first = manager.registerWebhookAgent('first', { state: 'running' });
  const second = manager.registerWebhookAgent('second', { state: 'running' });
  const store = useOfficeStore.getState();
  store.clearAgents();
  store.handleSnapshot(manager.getSnapshot());
  assert.equal(useOfficeStore.getState().agentHistory.get(first.id)?.[0].timestamp, first.stateChangedAt);
  store.selectAgent(first.id);
  store.followAgent(first.id);
  store.focusTeam(first.id);
  for (const agent of [first, second]) {
    store.handleEvent({ id: `start-${agent.id}`, sessionId: agent.id, timestamp: 100, type: 'tool', status: 'started', tool: 'Read', toolUseId: 'same-call-id' });
  }
  assert.equal(useOfficeStore.getState().pendingToolStarts.size, 2);
  store.handleSnapshot([second]);
  const reconciled = useOfficeStore.getState();
  assert.equal(reconciled.agentHistory.size, 1);
  assert.equal(reconciled.agentToolCounts.size, 1);
  assert.equal(reconciled.pendingToolStarts.size, 1);
  assert.equal(reconciled.selectedAgentId, null);
  assert.equal(reconciled.followedAgentId, null);
  assert.equal(reconciled.focusedAgentId, null);
  assert.equal(reconciled.focusedAgentIds.size, 0);
  store.handleEvent({ id: 'complete', sessionId: second.id, timestamp: 150, type: 'tool', status: 'completed', tool: 'Read', toolUseId: 'same-call-id' });
  assert.equal(useOfficeStore.getState().agentToolTime.get(second.id)?.get('Read'), 50);
  store.handleSnapshot([]);
  assert.equal(useOfficeStore.getState().agentToolTime.size, 0);
  assert.equal(useOfficeStore.getState().pendingToolStarts.size, 0);
});

test('snapshot removal cancels a previous leaving timer and attention events agree with snapshots', async (t) => {
  const manager = new SessionManager();
  t.after(() => { manager.dispose(); useOfficeStore.getState().clearAgents(); });
  const agent = manager.registerWebhookAgent('fixture', { state: 'running' });
  const store = useOfficeStore.getState();
  store.clearAgents();
  store.handleSnapshot(manager.getSnapshot());
  store.handleEvent({ id: 'end', sessionId: agent.id, timestamp: Date.now(), type: 'session', action: 'ended' });
  store.handleSnapshot([]);
  store.handleSnapshot(manager.getSnapshot());
  store.handleEvent({ id: 'waiting', sessionId: agent.id, timestamp: Date.now(), type: 'activity', action: 'waiting' });
  assert.equal(useOfficeStore.getState().agents.get(agent.id)?.waitingForHuman, true);
  await delay(2100);
  assert.equal(useOfficeStore.getState().agents.has(agent.id), true);
  store.clearAgents();
  assert.equal(useOfficeStore.getState().agentHistory.size, 0);
});
