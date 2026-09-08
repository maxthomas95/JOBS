#!/usr/bin/env node
// Compatibility for an existing Codex `notify` command. Never forward assistant text or cwd.
async function main() {
  let data;
  try { data = JSON.parse(process.argv[2] || ''); } catch { return; }
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
  if (data?.type !== 'agent-turn-complete' || !id(data['thread-id'])) return;
  const { randomUUID } = await import('node:crypto');
  const body = {
    type: 'agent-turn-complete', 'thread-id': id(data['thread-id']), 'turn-id': id(data['turn-id']),
    sent_at: Date.now(), event_id: randomUUID(),
  };
  const url = new URL(process.env.JOBS_URL || 'http://localhost:8780');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('url');
  const headers = { 'Content-Type': 'application/json' };
  const token = process.env.JOBS_TOKEN || process.env.WEBHOOK_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${url.href.replace(/\/$/, '')}/api/codex/notify`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) process.stderr.write(`[JOBS Codex] Notify returned HTTP ${response.status}; run setup-hooks.js --codex --check.\n`);
}
main().catch(() => process.stderr.write('[JOBS Codex] Notify unavailable; run setup-hooks.js --codex --check.\n'));
