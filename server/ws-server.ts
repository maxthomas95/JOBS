import type http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import type { PixelEvent, WSMessage } from '../src/types/events.js';
import { SessionManager } from './session-manager.js';
import type { StatsStore } from './stats-store.js';

export class WSServer {
  private readonly wss: WebSocketServer;
  private statsStore: StatsStore | null = null;
  private snapshotPending = false;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SNAPSHOT_THROTTLE_MS = 200;

  private readonly maxClients: number;
  private readonly maxPerIp: number;
  private readonly ipConnections = new Map<string, number>();
  private readonly token: string | null;

  constructor(
    server: http.Server,
    private readonly sessionManager: SessionManager,
    path = process.env.WS_PATH ?? '/ws',
    token: string | null = null,
  ) {
    this.maxClients = Number(process.env.WS_MAX_CLIENTS) || 50;
    this.maxPerIp = Number(process.env.WS_MAX_PER_IP) || 10;
    this.token = token;

    this.wss = new WebSocketServer({ server, path, maxPayload: 16 * 1024 });
    this.wss.on('connection', (ws, req) => {
      // Auth check
      if (this.token) {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const clientToken = url.searchParams.get('token');
        if (clientToken !== this.token) {
          ws.close(4401, 'Unauthorized');
          return;
        }
      }

      // Global connection limit
      if (this.wss.clients.size > this.maxClients) {
        ws.close(1013, 'Too many connections');
        return;
      }

      // Per-IP connection limit
      const clientIp = req.socket.remoteAddress ?? 'unknown';
      const currentCount = this.ipConnections.get(clientIp) ?? 0;
      if (currentCount >= this.maxPerIp) {
        ws.close(1013, 'Too many connections from this IP');
        return;
      }
      this.ipConnections.set(clientIp, currentCount + 1);

      // eslint-disable-next-line no-console
      console.log(`[ws] client connected (${this.wss.clients.size}) [${clientIp}]`);
      this.sendSnapshot(ws);
      ws.on('message', (raw) => {
        const message = this.tryParse(raw.toString());
        if (message?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' } satisfies WSMessage));
        }
      });
      ws.on('close', () => {
        const count = this.ipConnections.get(clientIp) ?? 1;
        if (count <= 1) {
          this.ipConnections.delete(clientIp);
        } else {
          this.ipConnections.set(clientIp, count - 1);
        }
        // eslint-disable-next-line no-console
        console.log(`[ws] client disconnected (${Math.max(0, this.wss.clients.size - 1)}) [${clientIp}]`);
      });
    });

    setInterval(() => {
      for (const client of this.wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'ping' } satisfies WSMessage));
        }
      }
    }, 30000).unref();
  }

  setStatsStore(store: StatsStore): void {
    this.statsStore = store;
  }

  broadcastSnapshot(): void {
    if (this.snapshotTimer) {
      // Timer already pending — just mark that another snapshot is needed
      this.snapshotPending = true;
      return;
    }
    // Send immediately
    this.sendSnapshotToAll();
    // Set cooldown timer
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      if (this.snapshotPending) {
        this.snapshotPending = false;
        this.sendSnapshotToAll();
      }
    }, WSServer.SNAPSHOT_THROTTLE_MS);
  }

  private sendSnapshotToAll(): void {
    const message: WSMessage = {
      type: 'snapshot',
      agents: this.sessionManager.getSnapshot(),
      timestamp: Date.now(),
      stats: this.statsStore?.getSummary(),
      machines: this.sessionManager.getMachines(),
    };
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  broadcast(event: PixelEvent): void {
    const message: WSMessage = { type: 'event', payload: event };
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  sendSnapshot(ws: WebSocket): void {
    const message: WSMessage = {
      type: 'snapshot',
      agents: this.sessionManager.getSnapshot(),
      timestamp: Date.now(),
      stats: this.statsStore?.getSummary(),
      machines: this.sessionManager.getMachines(),
    };
    ws.send(JSON.stringify(message));
  }

  close(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.wss.close();
  }

  private tryParse(raw: string): WSMessage | null {
    try {
      return JSON.parse(raw) as WSMessage;
    } catch {
      return null;
    }
  }
}
