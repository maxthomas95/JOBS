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
    const authCheck = new AbortController();

    const clearSession = () => {
      useOfficeStore.getState().clearAgents();
      useEventStore.setState({ events: [] });
      useStatsStore.setState({ stats: null });
    };

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

        if (!message || typeof message !== 'object') return;
        if (message.type === 'snapshot' && Array.isArray(message.agents)) {
          useOfficeStore.getState().handleSnapshot(message.agents, message.machines);
          if (message.stats) {
            useStatsStore.getState().updateStats(message.stats);
          }
        } else if (message.type === 'event' && message.payload && typeof message.payload === 'object') {
          useOfficeStore.getState().handleEvent(message.payload);
          useEventStore.getState().addEvent(message.payload);
        } else if (message.type === 'ping') {
          ws?.send(JSON.stringify({ type: 'pong' }));
        }
      };

      ws.onclose = async (event) => {
        useConnectionStore.getState().setStatus('disconnected');
        clearSession();
        if (pingTimer !== null) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (shouldReconnect) {
          if (event.code === 4401) {
            shouldReconnect = false;
            window.dispatchEvent(new Event('jobs:authentication-required'));
            return;
          }
          // The browser hides handshake HTTP status. Ask the same-origin API
          // before retrying so an expired cookie returns to sign-in promptly.
          try {
            const response = await fetch('/api/auth', { credentials: 'same-origin', signal: AbortSignal.any([authCheck.signal, AbortSignal.timeout(5000)]) });
            const auth = await response.json() as { authenticated?: boolean };
            if (shouldReconnect && auth.authenticated === false) {
              shouldReconnect = false;
              window.dispatchEvent(new Event('jobs:authentication-required'));
              return;
            }
          } catch { /* Server unavailable: normal bounded reconnect below. */ }
          if (!shouldReconnect) return;
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
      authCheck.abort();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
      }
      if (ws) {
        ws.onclose = null;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.close();
      }
      useConnectionStore.getState().setStatus('disconnected');
      clearSession();
    };
  }, [url]);
}
