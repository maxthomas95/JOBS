import 'dotenv/config';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import express from 'express';
import { SessionWatcher } from './bridge/watcher.js';
import { parseJsonlLine, transformToPixelEvents } from './bridge/parser.js';
import { SessionManager } from './session-manager.js';
import { WSServer } from './ws-server.js';
import { MockEventGenerator, SupervisorMockGenerator, WebhookMockGenerator, MultiInstanceMockGenerator } from './mock-events.js';
import { createSessionEvent } from './bridge/pixel-events.js';
import { createHookRouter } from './hook-receiver.js';
import { createWebhookRouter } from './webhook-receiver.js';
import { StatsStore } from './stats-store.js';
import { createRateLimiter } from './rate-limit.js';

/** Extract parent session UUID from a subagent file path.
 *  Path: ~/.claude/projects/<project>/<parent-uuid>/subagents/<child-uuid>.jsonl */
function extractParentFromPath(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, '/');
  const marker = '/projects/';
  const idx = normalized.indexOf(marker);
  if (idx === -1) return undefined;
  const parts = normalized.slice(idx + marker.length).split('/').filter(Boolean);
  if (parts.length === 4 && parts[2] === 'subagents') {
    return parts[1];
  }
  return undefined;
}

const app = express();
const port = Number(process.env.PORT ?? 8780);
const rawClaudeDir = process.env.CLAUDE_DIR ?? join(homedir(), '.claude');
const claudeDir = rawClaudeDir.startsWith('~')
  ? join(homedir(), rawClaudeDir.slice(1))
  : rawClaudeDir;
const mockMode = process.env.MOCK_EVENTS ?? '';
const useMock = ['true', 'supervisor', 'webhook', 'multi'].includes(mockMode);
const machineId = process.env.MACHINE_ID || undefined;
const machineName = process.env.MACHINE_NAME || undefined;
const jobsToken = process.env.JOBS_TOKEN || null;

app.use(express.json({ limit: '64kb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Serve index.html with optional token injection, other assets static
if (jobsToken) {
  let indexHtml: string;
  try {
    indexHtml = readFileSync(join('dist', 'index.html'), 'utf-8');
  } catch {
    indexHtml = '';
  }
  const injectedHtml = indexHtml.replace(
    '</head>',
    `  <meta name="jobs-token" content="${jobsToken}">\n  </head>`,
  );
  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(injectedHtml);
  });
  app.use(express.static('dist', { index: false }));
} else {
  app.use(express.static('dist'));
}

// Rate limiting
const apiLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 120 });
const healthLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

app.get('/healthz', healthLimiter, (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const sessionManager = new SessionManager(undefined, undefined, machineId, machineName);
const wsServer = new WSServer(server, sessionManager, undefined, jobsToken);

// Wire up snapshot callback so waiting-for-human detector can broadcast changes
sessionManager.setSnapshotCallback(() => wsServer.broadcastSnapshot());

// Stats persistence
const statsStore = new StatsStore();
sessionManager.setStatsStore(statsStore);
wsServer.setStatsStore(statsStore);

app.use('/api', apiLimiter);

app.get('/api/stats', (_req, res) => {
  res.json(statsStore.getStats());
});

// Mount hook receiver for Claude Code hooks integration
app.use(createHookRouter(sessionManager, wsServer, jobsToken));

// Mount webhook receiver for external integrations (CI/CD, Codex, monitoring)
app.use(createWebhookRouter(sessionManager, wsServer));

let watcher: SessionWatcher | null = null;

if (useMock) {
  // eslint-disable-next-line no-console
  console.log(`[mock] using '${mockMode}' mock events`);
  if (mockMode === 'webhook') {
    const mock = new WebhookMockGenerator();
    mock.start(sessionManager, wsServer);
  } else if (mockMode === 'multi') {
    const mock = new MultiInstanceMockGenerator();
    mock.start(sessionManager, wsServer);
  } else {
    const isSupervisorMode = mockMode === 'supervisor';
    const mock = isSupervisorMode ? new SupervisorMockGenerator() : new MockEventGenerator();
    mock.start((event) => {
      sessionManager.handleEvent(event);
      wsServer.broadcast(event);
    });
  }
} else {
  watcher = new SessionWatcher(claudeDir);

  watcher.on('session', ({ sessionId, filePath, agentId, isSubAgent, parentSessionId }) => {
    // eslint-disable-next-line no-console
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    console.log(`[watcher] session ${sessionId} (${fileName})${isSubAgent ? ` [subagent of ${parentSessionId?.slice(0, 12)}…]` : ''}`);
    sessionManager.registerSession(sessionId, filePath, parentSessionId);
    const started = createSessionEvent(sessionId, 'started', {
      agentId,
      project: filePath,
      source: 'watcher',
    });
    sessionManager.handleEvent(started);
    wsServer.broadcast(started);
    wsServer.broadcastSnapshot();
  });

  watcher.on('line', ({ line, sessionId, agentId, filePath }) => {
    // Re-register if session was evicted but file is still active
    if (!sessionManager.hasSession(sessionId)) {
      const restored = sessionManager.registerSession(sessionId, filePath, extractParentFromPath(filePath));
      // eslint-disable-next-line no-console
      console.log(`[watcher] re-registering evicted session ${sessionId} (as "${restored.name}")`);
      const restarted = createSessionEvent(sessionId, 'started', {
        agentId,
        project: filePath,
        source: 'watcher',
      });
      sessionManager.handleEvent(restarted);
      wsServer.broadcast(restarted);
      wsServer.broadcastSnapshot();
    }
    const raw = parseJsonlLine(line, sessionId, agentId);
    if (!raw) {
      return;
    }
    const events = transformToPixelEvents(raw);
    for (const event of events) {
      // eslint-disable-next-line no-console
      console.log(
        `[event] ${event.sessionId} ${event.type} ${
          'action' in event ? event.action : 'status' in event ? event.status : ''
        } ${event.type === 'tool' ? `(${event.tool})` : ''}`.trim(),
      );
      sessionManager.handleEvent(event);
      wsServer.broadcast(event);
    }
  });

  watcher.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.error('[watcher]', error.message);
  });

  // eslint-disable-next-line no-console
  console.log(`[watcher] watching ${claudeDir}`);
  watcher.start();
}

server.on('error', (error) => {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(`[server] port ${port} is already in use. Stop the other process or change PORT in .env.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`jobs server listening on http://localhost:${port} (mock=${useMock})`);
});

function gracefulShutdown() {
  // eslint-disable-next-line no-console
  console.log('[JOBS] Shutting down gracefully...');
  if (watcher) {
    watcher.stop();
  }
  wsServer.close();
  statsStore.flush();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
