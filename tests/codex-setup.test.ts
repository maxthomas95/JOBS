import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const setup = join(root, 'server/setup-hooks.js');
function home(t: TestContext) {
  const path = mkdtempSync(join(tmpdir(), 'jobs-codex-test-'));
  t.after(() => {
    assert.ok(resolve(path).startsWith(resolve(tmpdir()) + '\\') || resolve(path).startsWith(resolve(tmpdir()) + '/'));
    assert.ok(path.includes('jobs-codex-test-'));
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}
function install(configHome: string, args: string[] = []) {
  return spawnSync(process.execPath, [setup, '--codex', ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CODEX_HOME: configHome, JOBS_URL: '', JOBS_TOKEN: '', WEBHOOK_TOKEN: '' },
  });
}

test('installer preserves multiline TOML, unrelated and mixed hooks, creates backups, and is idempotent', t => {
  const path = home(t);
  const toml = 'notify = [\n  "existing-tool",\n  "--keep-me",\n]\n\n[model_providers.local]\nname = "keep"\n';
  writeFileSync(join(path, 'config.toml'), toml);
  const original = { description: 'Existing integration', hooks: { Stop: [{ matcher: 'keep', hooks: [{ type: 'command', command: 'existing-tool' }] }] } };
  writeFileSync(join(path, 'hooks.json'), JSON.stringify(original));
  const result = install(path);
  assert.equal(result.status, 0, result.stderr);
  const installed = readFileSync(join(path, 'hooks.json'), 'utf8');
  assert.equal(readFileSync(join(path, 'config.toml'), 'utf8'), toml);
  assert.deepEqual(JSON.parse(installed).hooks.Stop[0], original.hooks.Stop[0]);
  assert.equal(JSON.parse(installed).hooks.SessionEnd[0].hooks[0].async, false);
  assert.equal(typeof JSON.parse(installed).hooks.SessionStart[0].hooks[0].commandWindows, 'string');
  assert.equal(readdirSync(path).filter(name => name.includes('.jobs-backup-')).length, 1);
  assert.equal(install(path).status, 0);
  assert.equal(readFileSync(join(path, 'hooks.json'), 'utf8'), installed);
  assert.equal(readdirSync(path).filter(name => name.includes('.jobs-backup-')).length, 1);
  const mixed = JSON.parse(installed);
  mixed.hooks.Stop[1].hooks.push({ type: 'command', command: 'second-integration' });
  writeFileSync(join(path, 'hooks.json'), JSON.stringify(mixed));
  assert.equal(install(path, ['--remove']).status, 0);
  const removed = JSON.parse(readFileSync(join(path, 'hooks.json'), 'utf8'));
  assert.deepEqual(removed.hooks.Stop.map((entry: { hooks: unknown[] }) => entry.hooks), [[{ type: 'command', command: 'existing-tool' }], [{ type: 'command', command: 'second-integration' }]]);
  assert.equal(readFileSync(join(path, 'config.toml'), 'utf8'), toml);
  const before = readdirSync(path).length;
  assert.equal(install(path, ['--remove']).status, 0);
  assert.equal(readdirSync(path).length, before);
});

test('dry-run makes no files and malformed settings fail before script writes', t => {
  const path = home(t);
  assert.equal(install(path, ['--dry-run']).status, 0);
  assert.deepEqual(readdirSync(path), []);
  writeFileSync(join(path, 'hooks.json'), '{malformed');
  assert.equal(install(path).status, 1);
  assert.equal(readFileSync(join(path, 'hooks.json'), 'utf8'), '{malformed');
  assert.equal(existsSync(join(path, 'hooks')), false);
});

test('explicit config home takes precedence over CODEX_HOME', t => {
  const envHome = home(t);
  const explicitHome = home(t);
  assert.equal(install(envHome, ['--codex-home', explicitHome]).status, 0);
  assert.deepEqual(readdirSync(envHome), []);
  assert.ok(existsSync(join(explicitHome, 'hooks.json')));
});

async function runScript(script: string, args: string[], input: unknown, url: string) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root, env: { ...process.env, JOBS_URL: url, JOBS_TOKEN: 'synthetic-token', WEBHOOK_TOKEN: 'wrong-token' },
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  const [code] = await once(child, 'exit');
  return { code, stdout, stderr };
}

test('notifiers deliver metadata only with bearer auth; unknown notify does not connect', async t => {
  const requests: Array<{ path: string; auth: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ path: req.url!, auth: req.headers.authorization!, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, diagnostic: 'jobs-delivery-check-v1' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const hook = await runScript(join(root, 'server/hooks/codex-hook-notify.js'), [], {
    hook_event_name: 'PreToolUse', session_id: 'thread-one', turn_id: 'turn-one', tool_use_id: 'tool-one',
    tool_name: 'mcp__PRIVATE_TOOL', tool_input: { command: 'PRIVATE_COMMAND' }, tool_response: 'PRIVATE_RESPONSE',
    cwd: '/PRIVATE_PATH', transcript_path: '/PRIVATE_TRANSCRIPT', prompt: 'PRIVATE_PROMPT', last_assistant_message: 'PRIVATE_ASSISTANT',
  }, url);
  assert.equal(hook.code, 0);
  assert.equal(hook.stdout.trim(), '{}');
  assert.equal(hook.stderr, '');
  assert.doesNotMatch(JSON.stringify(requests), /PRIVATE_/);
  assert.equal(requests[0].auth, 'Bearer synthetic-token');
  assert.equal(requests[0].body.tool_name, 'MCP');
  const notify = await runScript(join(root, 'server/hooks/codex-notify.js'), [JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'thread-one', 'last-assistant-message': 'PRIVATE_RESPONSE', cwd: '/PRIVATE_PATH' })], undefined, url);
  assert.equal(notify.code, 0);
  assert.equal(requests[1].path, '/api/codex/notify');
  assert.doesNotMatch(JSON.stringify(requests), /PRIVATE_/);
  await runScript(join(root, 'server/hooks/codex-notify.js'), [JSON.stringify({ type: 'unknown', 'thread-id': 'thread-one' })], undefined, url);
  assert.equal(requests.length, 2);
  const path = home(t);
  assert.equal(install(path, ['--url', url]).status, 0);
  const configured = JSON.parse(readFileSync(join(path, 'hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0];
  // Exercise the exact installed command, including Windows quoting and stdin passthrough.
  const hookCommand = process.platform === 'win32' ? configured.commandWindows : configured.command;
  const child = spawn(process.platform === 'win32' ? 'powershell.exe' : '/bin/sh', process.platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', hookCommand]
    : ['-c', hookCommand], { env: { ...process.env, JOBS_URL: '', JOBS_TOKEN: 'synthetic-token' } });
  let commandError = '', commandOutput = '';
  child.stdout.on('data', data => { commandOutput += data; });
  child.stderr.on('data', data => { commandError += data; });
  child.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'installed-test', source: 'startup' }));
  assert.equal((await once(child, 'exit'))[0], 0, commandError);
  assert.equal(commandError, '');
  assert.equal(commandOutput.trim(), '{}', 'installed command returned its passive hook result');
  assert.equal(requests[2].body.session_id, 'installed-test');
  const emptyPath = home(t);
  const check = await runScript(setup, ['--codex', '--codex-home', emptyPath, '--check'], undefined, url);
  assert.equal(check.code, 0, check.stderr);
  assert.deepEqual(requests[3].body, { diagnostic: 'jobs-delivery-check-v1' });
  assert.deepEqual(readdirSync(emptyPath), []);
});

test('check explains authentication failure without disclosing tokens', async t => {
  const server = createServer((_req, res) => { res.writeHead(401); res.end(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const result = await runScript(setup, ['--codex', '--codex-home', home(t), '--check'], undefined, url);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Authentication failed/);
  assert.doesNotMatch(result.stderr + result.stdout, /synthetic-token|wrong-token/);
  const hook = await runScript(join(root, 'server/hooks/codex-hook-notify.js'), [], {
    hook_event_name: 'PermissionRequest', session_id: 'test', turn_id: 'turn-one',
  }, url);
  assert.equal(hook.code, 0);
  assert.equal(hook.stdout.trim(), '{}');
  assert.match(hook.stderr, /HTTP 401/);
  assert.doesNotMatch(hook.stderr, /synthetic-token|wrong-token/);
});
