import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { test } from 'node:test';
import { toPixelEvents } from '../server/bridge/claude-adapter.js';
import { publicEvent } from '../server/public-event.js';

test('Claude tools expose basenames and fixed activity labels, never tool input or prose', () => {
  const secrets = ['private-command', 'private-pattern', 'private-prompt', 'private-description', 'private-user'];
  const events = toPixelEvents({ type: 'assistant', input: { _sessionId: 'session-1' }, message: { content: [
    { type: 'text', text: secrets[2] },
    { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\private-user\\repo\\file.ts' } },
    { type: 'tool_use', name: 'Bash', input: { command: secrets[0], description: secrets[3] } },
    { type: 'tool_use', name: 'Grep', input: { pattern: secrets[1] } },
    { type: 'tool_use', name: 'Task', input: { prompt: secrets[2], description: secrets[3] } },
  ] } });
  const output = events.map(event => publicEvent({ ...event, transcript_path: 'private-user', raw: secrets }));
  for (const secret of secrets) assert.ok(!JSON.stringify(output).includes(secret));
  assert.deepEqual(output.map(event => event.type === 'tool' && event.context), ['file.ts', 'Running command', 'Searching', 'Delegating work']);
});

test('standalone Claude notifier redacts before transmitting', async t => {
  let received: unknown;
  let authorization: string | undefined;
  const server = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk.toString();
    received = JSON.parse(text);
    authorization = req.headers.authorization;
    res.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const child = spawn(process.execPath, ['server/hooks/jobs-notify.js'], {
    env: { ...process.env, JOBS_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, JOBS_TOKEN: 'fixture-only' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  child.stdin.end(JSON.stringify({ session_id: 'session-1', hook_event_name: 'PreToolUse', cwd: 'C:\\private-user\\project',
    tool_name: 'Bash', tool_input: { command: 'private-command' }, prompt: 'private-prompt', transcript_path: 'private-transcript' }));
  assert.equal(await exited, 0);
  assert.equal(authorization, 'Bearer fixture-only');
  assert.equal((received as { cwd: string }).cwd, 'project');
  assert.ok(!JSON.stringify(received).includes('private-'));
});
