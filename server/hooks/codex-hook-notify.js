#!/usr/bin/env node
// Passive Codex observer. Works inside this ESM repo and when copied to a config home.
// The only stdout is an empty hook result; this integration never makes approval decisions.
const startedAt = Date.now();
let finished = false;
function finish(message) {
  if (finished) return;
  finished = true;
  if (message) process.stderr.write(`[JOBS Codex] ${message}\n`);
  process.stdout.write('{}\n', () => process.exit(0));
}
const deadline = setTimeout(() => finish('Delivery timed out. Run setup-hooks.js --codex --check.'), 2000);
async function main() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) return finish('Hook input exceeded the 2 MiB limit; event skipped.');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return finish('Invalid hook input; event skipped.'); }
  const events = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'PreCompact', 'PostCompact', 'Stop', 'Interrupt', 'SessionEnd', 'SubagentStart', 'SubagentStop']);
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
  if (!data || !events.has(data.hook_event_name) || !id(data.session_id)) return finish();
  const category = value => {
    if (typeof value !== 'string') return 'Tool';
    const tool = value.replace(/^functions\./, '');
    if (['Bash', 'exec_command', 'shell', 'shell_command', 'write_stdin'].includes(tool)) return 'Bash';
    if (['apply_patch', 'Edit', 'Write'].includes(tool)) return 'Edit';
    if (['Read', 'read_file', 'view_image'].includes(tool)) return 'Read';
    if (['Grep', 'Glob', 'search', 'list_files'].includes(tool)) return 'Grep';
    if (['spawn_agent', 'Task', 'Agent'].includes(tool)) return 'Task';
    if (['web', 'web.run', 'WebFetch', 'WebSearch'].includes(tool)) return 'WebFetch';
    return tool.startsWith('mcp__') ? 'MCP' : 'Tool';
  };
  const { randomUUID } = await import('node:crypto');
  const body = {
    hook_event_name: data.hook_event_name, session_id: id(data.session_id),
    turn_id: id(data.turn_id), agent_id: id(data.agent_id), tool_use_id: id(data.tool_use_id),
    tool_name: category(data.tool_name), event_id: randomUUID(), sent_at: startedAt,
    source: ['startup', 'resume', 'clear', 'compact'].includes(data.source) ? data.source : undefined,
  };
  let configuredUrl;
  try {
    const { readFile } = await import('node:fs/promises');
    const { dirname, join } = await import('node:path');
    configuredUrl = JSON.parse(await readFile(join(dirname(process.argv[1]), 'codex-transport.json'), 'utf8')).url;
  } catch { /* Environment/default URL also work without installer configuration. */ }
  const url = new URL(process.env.JOBS_URL || configuredUrl || 'http://localhost:8780');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return finish('Invalid JOBS_URL; use an HTTP(S) URL without credentials.');
  const headers = { 'Content-Type': 'application/json' };
  const token = process.env.JOBS_TOKEN || process.env.WEBHOOK_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${url.href.replace(/\/$/, '')}/api/codex/hooks`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) return finish(`Delivery returned HTTP ${response.status}. Check URL, authentication, and server version with --codex --check.`);
  finish();
}
main().catch(() => finish('Server unavailable. Run setup-hooks.js --codex --check.')).finally(() => clearTimeout(deadline));
