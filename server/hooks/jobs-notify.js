#!/usr/bin/env node
// J.O.B.S. hook notify script (Node.js) — reads Claude Code hook JSON from stdin,
// POSTs to the JOBS server. Designed to be used as an async hook command.
// All errors are silently swallowed so Claude's work is never blocked.

const JOBS_URL = process.env.JOBS_URL || 'http://localhost:8780';

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim();
  if (!input) {
    process.exit(0);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await fetch(`${JOBS_URL}/api/hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: input,
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // Silently fail — never block Claude
  }
}

main().catch(() => process.exit(0));
