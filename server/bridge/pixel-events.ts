import { basename } from 'node:path';
import { v4 as uuid } from 'uuid';
import type {
  ActivityEvent,
  AgentEvent,
  ErrorEvent,
  SessionEvent,
  SummaryEvent,
  ToolEvent,
} from '../../src/types/events.js';

export function toBasename(inputPath: string): string {
  return basename(inputPath || 'unknown');
}

export function toProjectName(inputPath: string): string {
  return basename(inputPath || 'project');
}

export function createSessionEvent(
  sessionId: string,
  action: 'started' | 'ended',
  opts?: { project?: string; source?: string; agentId?: string; timestamp?: number; characterIndex?: number; deskIndex?: number | null },
): SessionEvent {
  return {
    id: uuid(),
    type: 'session',
    sessionId,
    action,
    timestamp: opts?.timestamp ?? Date.now(),
    project: opts?.project,
    source: opts?.source,
    agentId: opts?.agentId,
    characterIndex: opts?.characterIndex,
    deskIndex: opts?.deskIndex,
  };
}

export function createActivityEvent(
  sessionId: string,
  agentId: string,
  timestamp: number,
  action: ActivityEvent['action'],
  tokens?: number,
): ActivityEvent {
  return {
    id: uuid(),
    type: 'activity',
    sessionId,
    agentId,
    timestamp,
    action,
    tokens,
  };
}

export function createToolEvent(
  sessionId: string,
  agentId: string,
  timestamp: number,
  payload: {
    tool: string;
    status: ToolEvent['status'];
    toolUseId?: string;
    context?: string | null;
  },
): ToolEvent {
  return {
    id: uuid(),
    type: 'tool',
    sessionId,
    agentId,
    timestamp,
    tool: payload.tool,
    status: payload.status,
    toolUseId: payload.toolUseId,
    context: payload.context ?? null,
  };
}

export function createAgentEvent(
  sessionId: string,
  agentId: string,
  timestamp: number,
  action: AgentEvent['action'],
): AgentEvent {
  return {
    id: uuid(),
    type: 'agent',
    sessionId,
    agentId,
    timestamp,
    action,
  };
}

export function createErrorEvent(
  sessionId: string,
  agentId: string,
  timestamp: number,
  severity: ErrorEvent['severity'],
): ErrorEvent {
  return {
    id: uuid(),
    type: 'error',
    sessionId,
    agentId,
    timestamp,
    severity,
  };
}

export function createSummaryEvent(sessionId: string, timestamp: number): SummaryEvent {
  return {
    id: uuid(),
    type: 'summary',
    sessionId,
    timestamp,
  };
}
