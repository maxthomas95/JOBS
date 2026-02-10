import type { Agent } from './agent.js';

export interface BaseEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  agentId?: string;
}

export interface SessionEvent extends BaseEvent {
  type: 'session';
  action: 'started' | 'ended';
  project?: string;
  source?: string;
  characterIndex?: number;
  deskIndex?: number | null;
}

export interface ActivityEvent extends BaseEvent {
  type: 'activity';
  action: 'thinking' | 'responding' | 'waiting' | 'user_prompt';
  tokens?: number;
}

export interface ToolEvent extends BaseEvent {
  type: 'tool';
  tool: string;
  status: 'started' | 'completed' | 'error';
  context?: string | null;
  toolUseId?: string;
}

export interface AgentEvent extends BaseEvent {
  type: 'agent';
  action: 'spawned' | 'completed' | 'error';
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  severity: 'warning' | 'error';
}

export interface SummaryEvent extends BaseEvent {
  type: 'summary';
}

export type PixelEvent =
  | SessionEvent
  | ActivityEvent
  | ToolEvent
  | AgentEvent
  | ErrorEvent
  | SummaryEvent;

export type WSMessage =
  | { type: 'snapshot'; agents: Agent[]; timestamp: number }
  | { type: 'event'; payload: PixelEvent }
  | { type: 'ping' }
  | { type: 'pong' };
