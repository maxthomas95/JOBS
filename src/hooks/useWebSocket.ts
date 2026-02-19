import { useEffect } from 'react';
import type { WSMessage } from '../types/events.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { useEventStore } from '../state/useEventStore.js';
import { useConnectionStore } from '../state/useConnectionStore.js';
import { useStatsStore } from '../state/useStatsStore.js';

export function useWebSocket(url: string): void {
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let shouldReconnect = true;
    let reconnectDelay = 3000;

    const connect = () => {
      useConnectionStore.getState().setStatus('connecting');
      ws = new WebSocket(url);

      ws.onopen = () => {
        useConnectionStore.getState().setStatus('connected');
        reconnectDelay = 3000;
        pingTimer = window.setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (evt) => {
        let message: WSMessage | null = null;
        try {
          message = JSON.parse(evt.data) as WSMessage;
        } catch {
          return;
        }

        if (message.type === 'snapshot') {
          useOfficeStore.getState().handleSnapshot(message.agents, message.machines);
          if (message.stats) {
            useStatsStore.getState().updateStats(message.stats);
          }
        } else if (message.type === 'event') {
          useOfficeStore.getState().handleEvent(message.payload);
          useEventStore.getState().addEvent(message.payload);
        } else if (message.type === 'ping') {
          ws?.send(JSON.stringify({ type: 'pong' }));
        }
      };

      ws.onclose = () => {
        useConnectionStore.getState().setStatus('disconnected');
        useOfficeStore.getState().clearAgents();
        if (pingTimer !== null) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (shouldReconnect) {
          reconnectTimer = window.setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 60000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      shouldReconnect = false;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
      }
      ws?.close();
    };
  }, [url]);
}
