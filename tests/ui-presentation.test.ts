import assert from 'node:assert/strict';
import test from 'node:test';
import { agentName, hasToolActivity, integrationLabel, needsAttention, statusLabel } from '../src/ui/sessionPresentation.js';
import type { MonitoredAgent } from '../src/ui/sessionPresentation.js';

function fixture(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    id: 'test-session', sessionId: 'test-session', characterIndex: 0, state: 'waiting',
    position: { x: 8, y: 8 }, targetPosition: null, deskIndex: null,
    lastEventAt: 1000, stateChangedAt: 1000, activityText: null, name: 'Codex CLI',
    roleName: null, project: 'example', waitingForHuman: false, parentId: null, childIds: [],
    provider: 'codex', machineId: null, machineName: null, sourceType: null, sourceName: null, sourceUrl: null,
    ...overrides,
  };
}

test('notify and legacy Codex sessions disclose completion-only capabilities', () => {
  for (const integrationMode of [undefined, 'notify'] as const) {
    const agent = fixture({ integrationMode });
    assert.equal(integrationLabel(agent), 'Completion updates');
    assert.equal(hasToolActivity(agent), false);
  }
});

test('tool displays require hooks or transcript monitoring', () => {
  assert.equal(hasToolActivity(fixture({ integrationMode: 'hooks' })), true);
  assert.equal(hasToolActivity(fixture({ provider: 'claude', integrationMode: 'transcript' })), true);
  assert.equal(hasToolActivity(fixture({ provider: 'webhook', integrationMode: 'webhook' })), false);
});

test('attention and status include canonical Codex input waits, approvals, and errors', () => {
  assert.equal(needsAttention(fixture({ waitingForHuman: true })), true);
  assert.equal(statusLabel(fixture({ waitingForHuman: true })), 'Needs input');
  assert.equal(needsAttention(fixture({ state: 'needsApproval' })), true);
  assert.equal(statusLabel(fixture({ state: 'needsApproval', waitingForHuman: true })), 'Needs approval');
  assert.equal(needsAttention(fixture({ state: 'error' })), true);
  assert.equal(needsAttention(fixture({ state: 'idle' })), false);
});

test('generic Codex names distinguish simultaneous sessions without exposing prefixes', () => {
  const first = agentName(fixture({ sessionId: 'wh:codex-thread-abcdefgh' }));
  const second = agentName(fixture({ sessionId: 'wh:codex-thread-ijklmnop' }));
  assert.notEqual(first, second);
  assert.equal(first, 'Codex CLI abcdefgh');
  assert.equal(agentName(fixture({ roleName: 'Review auth flow' })), 'Review auth flow');
});
