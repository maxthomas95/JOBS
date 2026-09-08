import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexProvider, type CodexSessionSink } from '../server/codex-provider.ts';
import type { PixelEvent } from '../src/types/events.ts';

function fixture() {
  let now = 100_000;
  const events: PixelEvent[] = [];
  const registrations: Array<{ sourceId: string; opts: Parameters<CodexSessionSink['registerWebhookAgent']>[1] }> = [];
  const provider = new CodexProvider({
    registerWebhookAgent(sourceId, opts) { registrations.push({ sourceId, opts }); return { id: `wh:${sourceId}` }; },
    handleEvent(event) { events.push(event); },
  }, undefined, () => now);
  const send = (event: string, fields: Record<string, unknown> = {}) => provider.ingest({
    session_id: 'thread-one', turn_id: 'turn-one', hook_event_name: event, sent_at: ++now, ...fields,
  });
  return { provider, events, registrations, send };
}

test('lifecycle emits safe tool categories and canonical attention activities', () => {
  const { send, events, registrations, provider } = fixture();
  const privateData = {
    prompt: 'PRIVATE_PROMPT', cwd: 'C:\\private\\PRIVATE_CWD', transcript_path: '/PRIVATE_TRANSCRIPT',
    tool_input: { command: 'PRIVATE_COMMAND', pattern: 'PRIVATE_PATTERN' }, tool_response: 'PRIVATE_RESPONSE',
    last_assistant_message: 'PRIVATE_ASSISTANT', model: 'PRIVATE_MODEL',
  };
  send('SessionStart', { ...privateData, source: 'startup' });
  send('UserPromptSubmit', privateData);
  send('PreToolUse', { ...privateData, tool_name: 'mcp__PRIVATE_SERVER__PRIVATE_TOOL', tool_use_id: 'PRIVATE_TOOL_ID' });
  send('PermissionRequest', privateData);
  send('PostToolUse', { ...privateData, tool_name: 'mcp__PRIVATE_SERVER__PRIVATE_TOOL', tool_use_id: 'PRIVATE_TOOL_ID' });
  send('PreCompact', privateData);
  send('PostCompact', privateData);
  send('Stop', privateData);
  const publicData = JSON.stringify({ events, registrations, health: provider.health() });
  assert.doesNotMatch(publicData, /PRIVATE_/);
  assert.deepEqual(events.filter(e => e.type === 'activity').map(e => e.action), ['user_prompt', 'needsApproval', 'thinking', 'compacting', 'thinking', 'waiting']);
  assert.equal(events.find(e => e.type === 'tool')?.tool, 'MCP');
  assert.equal(provider.health().capabilities.usage, false);
  assert.equal(provider.health().mode, 'hooks');
});

test('duplicates and out-of-order delivery cannot revive completed tools or turns', () => {
  const { send, events } = fixture();
  send('UserPromptSubmit');
  send('PostToolUse', { tool_use_id: 'tool-one', tool_name: 'Bash' });
  assert.equal(send('PreToolUse', { tool_use_id: 'tool-one', tool_name: 'Bash' }).accepted, false);
  assert.equal(send('PostToolUse', { tool_use_id: 'tool-one', tool_name: 'Bash' }).accepted, false);
  send('Stop');
  const count = events.length;
  for (const event of ['PreToolUse', 'PermissionRequest', 'PostCompact', 'UserPromptSubmit', 'Stop']) {
    assert.equal(send(event, { tool_use_id: 'late-tool' }).accepted, false);
  }
  assert.equal(events.length, count);
  assert.equal(send('UserPromptSubmit', { turn_id: 'turn-two' }).accepted, true);
  assert.equal(send('Stop', { turn_id: 'turn-one' }).accepted, false);
  assert.equal(send('PreToolUse', { turn_id: 'turn-two', tool_use_id: 'tool-two' }).accepted, true);
});

test('session closure rejects old activity and allows explicit resume with a new turn', () => {
  const { send } = fixture();
  send('UserPromptSubmit');
  send('SessionEnd', { turn_id: undefined });
  assert.equal(send('PreToolUse', { tool_use_id: 'late' }).accepted, false);
  assert.equal(send('SessionStart', { source: 'startup', turn_id: undefined }).accepted, false);
  assert.equal(send('SessionStart', { source: 'resume', turn_id: undefined }).accepted, true);
  assert.equal(send('UserPromptSubmit', { turn_id: 'turn-two' }).accepted, true);
});

test('subagent lifecycle uses child identity and parent relationship without assigning the parent turn', () => {
  const { send, registrations, events } = fixture();
  send('SubagentStart', { agent_id: 'child-one' });
  assert.equal(registrations[0].sourceId, 'codex-child-one');
  assert.equal(registrations[0].opts.parentId, 'wh:codex-thread-one');
  assert.equal(send('PreToolUse', { session_id: 'child-one', turn_id: 'child-turn', tool_use_id: 'child-tool' }).accepted, true);
  assert.equal(send('SubagentStop', { agent_id: 'child-one' }).accepted, true);
  assert.equal(events.at(-1)?.sessionId, 'wh:codex-child-one');
  assert.equal(send('PreToolUse', { session_id: 'child-one', turn_id: 'child-turn', tool_use_id: 'late-child-tool' }).accepted, false);
});

test('notify remains completion-only, ignores unknown events, and yields to lifecycle hooks', () => {
  const { provider, send, events } = fixture();
  assert.equal(provider.ingest({ type: 'unknown', 'thread-id': 'thread-one' }, 'notify').accepted, false);
  assert.equal(provider.health().mode, 'unobserved');
  assert.equal(provider.ingest({ type: 'agent-turn-complete', 'thread-id': 'thread-one', 'turn-id': 'old-turn' }, 'notify').accepted, true);
  assert.equal(provider.health().capabilities.tools, false);
  assert.equal(provider.ingest({ type: 'agent-turn-complete', 'thread-id': 'thread-one', 'turn-id': 'new-turn' }, 'notify').accepted, true);
  send('UserPromptSubmit');
  assert.equal(provider.ingest({ type: 'agent-turn-complete', 'thread-id': 'thread-one' }, 'notify').accepted, false);
  assert.equal(events.at(-1)?.type, 'activity');
});

test('invalid identity, missing turn/call ids and stale timestamps are rejected', () => {
  const { send } = fixture();
  assert.equal(send('Stop', { session_id: '/private/path' }).accepted, false);
  assert.equal(send('Stop', { turn_id: undefined }).accepted, false);
  assert.equal(send('PreToolUse').accepted, false);
  assert.equal(send('Stop', { sent_at: -100_000_000 }).accepted, false);
});
