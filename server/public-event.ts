import type { PixelEvent } from '../src/types/events.js';
import { safeBasename, safeIdentifier } from './sanitize.js';

export function safeToolContext(tool: string, input?: Record<string, unknown>): string | null {
  const name = tool.toLowerCase();
  if (['read', 'write', 'edit', 'multiedit', 'notebookedit', 'apply_patch'].includes(name)) {
    return safeBasename(input?.file_path);
  }
  if (name.includes('bash') || name === 'exec_command' || name === 'write_stdin') return 'Running command';
  if (name.includes('search') || name.includes('grep') || name.includes('glob')) return 'Searching';
  if (name === 'task' || name === 'agent' || name === 'spawn_agent') return 'Delegating work';
  return null;
}

/** A final transport allowlist protects against accidental extra runtime fields. */
export function publicEvent(event: PixelEvent): PixelEvent {
  const base = { id: event.id, sessionId: event.sessionId, timestamp: event.timestamp, agentId: event.agentId };
  switch (event.type) {
    case 'session': return {
      ...base, type: 'session', action: event.action, project: safeBasename(event.project) ?? undefined,
      roleName: safeIdentifier(event.roleName) ?? undefined, source: safeIdentifier(event.source) ?? undefined,
      characterIndex: event.characterIndex, deskIndex: event.deskIndex, name: event.name, parentId: event.parentId,
    };
    case 'tool': return {
      ...base, type: 'tool', tool: safeIdentifier(event.tool) ?? 'unknown_tool', status: event.status,
      toolUseId: event.toolUseId, context: safeToolContext(event.tool, { file_path: event.context }),
    };
    case 'activity': return { ...base, type: 'activity', action: event.action, tokens: event.tokens };
    case 'agent': return { ...base, type: 'agent', action: event.action };
    case 'error': return { ...base, type: 'error', severity: event.severity };
    case 'summary': return { ...base, type: 'summary' };
  }
}
