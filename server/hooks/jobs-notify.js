#!/usr/bin/env node
// Standalone in either a CommonJS or ESM home. Send metadata, never raw hook input.
async function main() {
  const { hostname } = await import('node:os');
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) return;
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return; }
  if (!input || typeof input !== 'object') return;
  const identifier = value => typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value) ? value : undefined;
  const basename = value => typeof value === 'string'
    ? value.replace(/\\/g, '/').split('/').filter(Boolean).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 128)
    : undefined;
  const body = {
    session_id: identifier(input.session_id), hook_event_name: identifier(input.hook_event_name),
    cwd: basename(input.cwd), agent_id: identifier(input.agent_id), agent_type: identifier(input.agent_type),
    tool_name: identifier(input.tool_name), notification_type: identifier(input.notification_type),
    machine_id: identifier(process.env.MACHINE_ID || hostname()),
    machine_name: identifier(process.env.MACHINE_NAME || process.env.MACHINE_ID || hostname()),
  };
  if (!body.session_id || !body.hook_event_name) return;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.JOBS_TOKEN) headers.Authorization = `Bearer ${process.env.JOBS_TOKEN}`;
  await fetch(`${process.env.JOBS_URL || 'http://localhost:8780'}/api/hooks`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
  });
}
main().catch(() => { /* Telemetry never interrupts agent work. */ });
