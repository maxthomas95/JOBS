import 'dotenv/config';
import { homedir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import express from 'express';
import { SessionWatcher } from './bridge/watcher.js';
import { parseJsonlLine, transformToPixelEvents } from './bridge/parser.js';
import { SessionManager } from './session-manager.js';
import { WSServer } from './ws-server.js';
import { MockEventGenerator, SupervisorMockGenerator } from './mock-events.js';
import { createSessionEvent } from './bridge/pixel-events.js';

const app = express();
const port = Number(process.env.PORT ?? 8780);
const rawClaudeDir = process.env.CLAUDE_DIR ?? join(homedir(), '.claude');
const claudeDir = rawClaudeDir.startsWith('~')
  ? join(homedir(), rawClaudeDir.slice(1))
  : rawClaudeDir;
const mockMode = process.env.MOCK_EVENTS ?? '';
const useMock = mockMode === 'true' || mockMode === 'supervisor';

app.use(express.static('dist'));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const sessionManager = new SessionManager();
const wsServer = new WSServer(server, sessionManager);

// Wire up snapshot callback so waiting-for-human detector can broadcast changes
sessionManager.setSnapshotCallback(() => wsServer.broadcastSnapshot());

if (useMock) {
  const isSupervisorMode = mockMode === 'supervisor';
  // eslint-disable-next-line no-console
  console.log(`[mock] using ${isSupervisorMode ? 'supervisor' : 'basic'} mock events`);
  const mock = isSupervisorMode ? new SupervisorMockGenerator() : new MockEventGenerator();
  mock.start((event) => {
    sessionManager.handleEvent(event);
    wsServer.broadcast(event);
  });
} else {
  const watcher = new SessionWatcher(claudeDir);

  watcher.on('session', ({ sessionId, filePath, agentId }) => {
    // eslint-disable-next-line no-console
    console.log(`[watcher] session ${sessionId} (${filePath})`);
    sessionManager.registerSession(sessionId, filePath);
    const started = createSessionEvent(sessionId, 'started', {
      agentId,
      project: filePath,
      source: 'watcher',
    });
    sessionManager.handleEvent(started);
    wsServer.broadcast(started);
    wsServer.broadcastSnapshot();
  });

  watcher.on('line', ({ line, sessionId, agentId }) => {
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
