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
  roleName?: string;
  source?: string;
  characterIndex?: number;
  deskIndex?: number | null;
  name?: string;
  /** Session ID of the parent agent that spawned this one */
  parentId?: string | null;
}

export interface ActivityEvent extends BaseEvent {
  type: 'activity';
  action: 'thinking' | 'responding' | 'waiting' | 'user_prompt' | 'needsApproval' | 'compacting';
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

export interface StatsSummary {
  sessionsToday: number;
  totalSessions: number;
  totalHours: number;
  topTools: Array<{ tool: string; count: number }>;
}

export type WSMessage =
  | { type: 'snapshot'; agents: Agent[]; timestamp: number; stats?: StatsSummary }
  | { type: 'event'; payload: PixelEvent }
  | { type: 'ping' }
  | { type: 'pong' };
