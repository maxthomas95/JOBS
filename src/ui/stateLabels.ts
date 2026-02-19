import type { AgentState } from '../types/agent.js';

export const STATE_LABELS: Record<AgentState, string> = {
  entering: 'Arriving',
  coding: 'Coding',
  reading: 'Reading',
  thinking: 'Thinking',
  terminal: 'Terminal',
  searching: 'Searching',
  cooling: 'Coffee Break',
  delegating: 'Delegating',
  error: 'Error',
  waiting: 'Waiting',
  needsApproval: 'Needs Approval',
  compacting: 'Compacting',
  idle: 'Idle',
  leaving: 'Leaving',
};

export const STATE_COLORS: Record<AgentState, string> = {
  entering: '#81c784',
  coding: '#42a5f5',
  reading: '#42a5f5',
  thinking: '#7c4dff',
  terminal: '#2ee65e',
  searching: '#ffa726',
  cooling: '#90a4ae',
  delegating: '#ce93d8',
  error: '#ff4444',
  waiting: '#ffeb3b',
  needsApproval: '#ff9800',
  compacting: '#ab47bc',
  idle: '#666',
  leaving: '#999',
};
