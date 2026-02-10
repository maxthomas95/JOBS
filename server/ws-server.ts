import type http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import type { PixelEvent, WSMessage } from '../src/types/events.js';
import { SessionManager } from './session-manager.js';

export class WSServer {
  private readonly wss: WebSocketServer;

  constructor(server: http.Server, private readonly sessionManager: SessionManager, path = process.env.WS_PATH ?? '/ws') {
    this.wss = new WebSocketServer({ server, path });
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

  broadcastSnapshot(): void {
    const message: WSMessage = {
      type: 'snapshot',
      agents: this.sessionManager.getSnapshot(),
      timestamp: Date.now(),
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
    };
    ws.send(JSON.stringify(message));
  }

  private tryParse(raw: string): WSMessage | null {
    try {
      return JSON.parse(raw) as WSMessage;
    } catch {
      return null;
    }
  }
}
