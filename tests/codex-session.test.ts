import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexProvider } from '../server/codex-provider.ts';
import { SessionManager } from '../server/session-manager.ts';
import { StatsStore } from '../server/stats-store.ts';

test('real sessions preserve Codex state, tool accounting, approval transitions, and public privacy', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jobs-codex-session-'));
  const stats = new StatsStore(join(directory, 'stats.json'));
  const manager = new SessionManager();
  manager.setStatsStore(stats);
  t.after(() => {
    manager.dispose(); stats.dispose();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  let now = Date.now();
  const provider = new CodexProvider(manager, undefined, () => now);
  const send = (event: string, fields: Record<string, unknown> = {}) => provider.ingest({
    hook_event_name: event, session_id: 'integrated', turn_id: 'turn-one', sent_at: ++now, ...fields,
    prompt: 'PRIVATE_PROMPT', tool_input: { command: 'PRIVATE_COMMAND' }, cwd: '/PRIVATE_PATH', transcript_path: '/PRIVATE_TRANSCRIPT',
  });
  const agent = () => manager.getSnapshot().find(a => a.id === 'wh:codex-integrated')!;
  send('SessionStart', { turn_id: undefined, source: 'startup' });
  assert.equal(agent().provider, 'codex');
  assert.equal(agent().integrationMode, 'hooks');
  send('UserPromptSubmit');
  assert.equal(agent().state, 'thinking');
  send('PreToolUse', { tool_name: 'Bash', tool_use_id: 'call-one' });
  assert.equal(agent().state, 'terminal');
  send('PermissionRequest'); // Documented approval payload has turn_id, but no tool_use_id.
  assert.equal(agent().state, 'needsApproval');
  assert.equal(agent().waitingForHuman, true);
  send('PostToolUse', { tool_name: 'Bash', tool_use_id: 'call-one' });
  assert.equal(agent().state, 'thinking');
  assert.equal(agent().waitingForHuman, false);
  send('PreToolUse', { tool_name: 'Bash', tool_use_id: 'call-one', event_id: 'redelivery' });
  assert.equal(stats.getSummary().topTools.find(tool => tool.tool === 'Bash')?.count, 1);
  send('PreCompact', { trigger: 'manual' });
  assert.equal(agent().state, 'compacting');
  send('PostCompact');
  send('Stop');
  assert.equal(agent().state, 'waiting');
  assert.equal(agent().waitingForHuman, true);
  send('PreToolUse', { tool_name: 'Bash', tool_use_id: 'late-call' });
  assert.equal(agent().state, 'waiting');
  send('UserPromptSubmit', { turn_id: 'turn-two' });
  assert.equal(agent().waitingForHuman, false);
  assert.equal(agent().state, 'thinking');
  assert.equal(stats.getSummary().totalSessions, 1);
  assert.doesNotMatch(JSON.stringify(manager.getSnapshot()), /PRIVATE_|filePath/);
});

test('missing turn IDs cannot guess approval/compaction state; SessionEnd works without a turn ID', t => {
  const manager = new SessionManager();
  t.after(() => manager.dispose());
  const provider = new CodexProvider(manager);
  provider.ingest({ hook_event_name: 'UserPromptSubmit', session_id: 'fixture', turn_id: 'one' });
  for (const hook_event_name of ['PermissionRequest', 'PreCompact', 'PostCompact']) {
    assert.equal(provider.ingest({ hook_event_name, session_id: 'fixture' }).accepted, false);
    assert.equal(manager.getSnapshot()[0].state, 'thinking');
  }
  assert.equal(provider.ingest({ hook_event_name: 'SessionEnd', session_id: 'fixture', reason: 'other' }).accepted, true);
  assert.equal(manager.getSnapshot()[0].state, 'leaving');
});

test('late session end and pending removal cannot delete a resumed Codex session', async t => {
  const manager = new SessionManager();
  t.after(() => manager.dispose());
  let now = Date.now();
  const provider = new CodexProvider(manager, undefined, () => now);
  const send = (hook_event_name: string, fields: Record<string, unknown> = {}) => provider.ingest({ session_id: 'resumed', hook_event_name, sent_at: ++now, ...fields });
  send('UserPromptSubmit', { turn_id: 'one' });
  send('SessionEnd');
  const endedAt = now;
  assert.equal(manager.getSnapshot()[0].state, 'leaving');
  send('SessionStart', { source: 'resume' });
  send('UserPromptSubmit', { turn_id: 'two' });
  assert.equal(send('SessionEnd', { sent_at: endedAt, event_id: 'delayed-end' }).accepted, false);
  assert.equal(send('PostToolUse', { turn_id: 'one', tool_use_id: 'late' }).accepted, false);
  await delay(2100);
  assert.equal(manager.getSnapshot()[0].state, 'thinking');
  assert.equal(manager.hasSession('wh:codex-resumed'), true);
});

test('child hooks link a later parent and use independent child turns', t => {
  const manager = new SessionManager();
  t.after(() => manager.dispose());
  const provider = new CodexProvider(manager);
  assert.equal(provider.ingest({ hook_event_name: 'SubagentStart', session_id: 'parent', turn_id: 'parent-turn', agent_id: 'child' }).accepted, true);
  provider.ingest({ hook_event_name: 'PreToolUse', session_id: 'child', turn_id: 'child-turn', tool_name: 'Read', tool_use_id: 'child-call' });
  provider.ingest({ hook_event_name: 'SessionStart', session_id: 'parent', source: 'startup' });
  const snapshot = manager.getSnapshot();
  assert.deepEqual(snapshot.find(a => a.id === 'wh:codex-parent')?.childIds, ['wh:codex-child']);
  assert.equal(snapshot.find(a => a.id === 'wh:codex-child')?.parentId, 'wh:codex-parent');
  assert.equal(snapshot.find(a => a.id === 'wh:codex-child')?.state, 'reading');
  provider.ingest({ hook_event_name: 'SubagentStop', session_id: 'parent', turn_id: 'parent-turn', agent_id: 'child' });
  assert.equal(manager.getSnapshot().find(a => a.id === 'wh:codex-child')?.state, 'leaving');
});
