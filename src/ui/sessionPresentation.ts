import type { Agent } from '../types/agent.js';
import type { PixelEvent } from '../types/events.js';
import { STATE_LABELS } from './stateLabels.js';

export type MonitoredAgent = Agent & {
  startedAt?: number;
  integrationMode?: 'transcript' | 'hooks' | 'notify' | 'webhook';
  model?: string;
};

export function agentName(agent: Agent): string {
  const name = agent.roleName || agent.name || agent.sourceName || 'Session';
  return agent.provider === 'codex' && /^(Codex|Codex CLI)$/i.test(name)
    ? `${name} ${agent.sessionId.replace(/^wh:/, '').replace(/^codex-/, '').slice(-8)}` : name;
}
export function providerName(agent: Agent): string {
  return agent.provider === 'claude' ? 'Claude' : agent.provider === 'codex' ? 'Codex' : agent.sourceName || 'Webhook';
}
export function needsAttention(agent: Agent): boolean {
  return agent.waitingForHuman || agent.state === 'needsApproval' || agent.state === 'error';
}
export function statusLabel(agent: Agent): string {
  return agent.state === 'needsApproval' ? 'Needs approval' : agent.waitingForHuman ? 'Needs input' : STATE_LABELS[agent.state];
}
export function integrationLabel(agent: MonitoredAgent): string {
  if (agent.integrationMode === 'hooks') return 'Lifecycle hooks';
  if (agent.integrationMode === 'transcript') return 'Transcript activity';
  if (agent.integrationMode === 'notify') return 'Completion updates';
  if (agent.integrationMode === 'webhook') return 'External updates';
  return agent.provider === 'codex' ? 'Completion updates' : agent.provider === 'claude' ? 'Transcript activity' : 'External updates';
}
export function hasToolActivity(agent: MonitoredAgent): boolean {
  return agent.integrationMode === 'hooks' || agent.integrationMode === 'transcript' || (!agent.integrationMode && agent.provider === 'claude');
}
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function lastActivity(at: number, now: number): string {
  return now - at < 5000 ? 'Just now' : `${elapsed(now - at)} ago`;
}
export function eventDescription(event: PixelEvent): string {
  if (event.type === 'tool') return `${event.tool} ${event.status}${event.context ? ` · ${event.context}` : ''}`;
  if (event.type === 'session') return event.action === 'started' ? 'Session started' : 'Session ended';
  if (event.type === 'agent') return `Agent ${event.action}`;
  if (event.type === 'error') return event.severity === 'warning' ? 'Warning reported' : 'Error reported';
  if (event.type === 'summary') return 'Session summary updated';
  const labels: Record<string, string> = {
    thinking: 'Thinking', responding: 'Responding', waiting: 'Waiting for input',
    user_prompt: 'New turn started', needsApproval: 'Approval requested', compacting: 'Compacting context',
  };
  return labels[event.action] || event.action;
}
