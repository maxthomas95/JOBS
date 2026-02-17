#!/usr/bin/env node
// J.O.B.S. Codex CLI notify script — receives Codex notification JSON as argv[1],
// reformats it into a JOBS webhook POST payload. Designed to be used as a Codex
// notify command in ~/.codex/config.toml.
//
// Usage in config.toml:
//   notify = ["node", "/path/to/codex-notify.js"]
//
// All errors are silently swallowed so Codex's work is never blocked.

const JOBS_URL = process.env.JOBS_URL || 'http://localhost:8780';
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || '';

async function main() {
  // Codex passes the JSON payload as a command-line argument
  const raw = process.argv[2];
  if (!raw) {
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const eventType = payload.type;
  const threadId = payload['thread-id'] || 'codex-default';
  const sourceId = `codex-${threadId}`;

  // Strip sensitive content (assistant message may contain code/secrets)
  const activity = payload['last-assistant-message']
    ? payload['last-assistant-message'].slice(0, 80).replace(/[\n\r]+/g, ' ')
    : undefined;

  // Map Codex event types to JOBS webhook events
  let webhookEvent;
  let webhookState;

  if (eventType === 'agent-turn-complete') {
    webhookEvent = 'status';
    webhookState = 'waiting';
  } else {
    // Unknown event type — send as status update
    webhookEvent = 'status';
    webhookState = 'running';
  }

  // Check if this agent already exists — if not, send start first
  const body = {
    source_id: sourceId,
    event: webhookEvent,
    source_name: 'Codex CLI',
    source_type: 'codex',
    project: payload.cwd ? payload.cwd.split(/[/\\]/).pop() : undefined,
    state: webhookState,
    activity,
  };

  if (WEBHOOK_TOKEN) {
    body.token = WEBHOOK_TOKEN;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // Try status update first
    const res = await fetch(`${JOBS_URL}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // If agent not found (404), register it first then retry
    if (res.status === 404) {
      body.event = 'start';
      await fetch(`${JOBS_URL}/api/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    }

    clearTimeout(timeout);
  } catch {
    // Silently fail — never block Codex
  }
}

main().catch(() => process.exit(0));
