import type { PixelEvent } from '../../src/types/events.js';

export interface RawContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
}

export interface RawMessage {
  role?: string;
  content?: RawContentBlock[];
  stop_reason?: string | null;
}

export interface RawJsonlEvent {
  type?: string;
  timestamp?: string;
  message?: RawMessage;
  userType?: string;
  toolUseId?: string;
  toolName?: string;
  isError?: boolean;
  input?: Record<string, unknown>;
  /** Present on 'result' type events — indicates why the turn ended */
  stop_reason?: string;
  /** Some result events nest stop_reason inside a result object */
  result?: { stop_reason?: string };
}

export interface WatchSessionPayload {
  sessionId: string;
  agentId: string;
  filePath: string;
  isSubAgent?: boolean;
}

export interface WatchLinePayload {
  line: string;
  sessionId: string;
  agentId: string;
  filePath: string;
}

export interface WatcherEvents {
  session: (payload: WatchSessionPayload) => void;
  line: (payload: WatchLinePayload) => void;
  error: (error: Error) => void;
}

export type EventTransform = (raw: RawJsonlEvent) => PixelEvent[];
