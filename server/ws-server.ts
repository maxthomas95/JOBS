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

  constructor(server: http.Server, private readonly sessionManager: SessionManager, path = process.env.WS_PATH ?? '/ws') {
    this.wss = new WebSocketServer({ server, path, maxPayload: 16 * 1024 });
    this.wss.on('connection', (ws) => {
      // eslint-disable-next-line no-console
      console.log(`[ws] client connected (${this.wss.clients.size})`);
      this.sendSnapshot(ws);
      ws.on('message', (raw) => {
        const message = this.tryParse(raw.toString());
        if (message?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' } satisfies WSMessage));
        }
      });
      ws.on('close', () => {
        // eslint-disable-next-line no-console
        console.log(`[ws] client disconnected (${Math.max(0, this.wss.clients.size - 1)})`);
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
