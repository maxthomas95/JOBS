import type { PixelEvent } from '../../src/types/events.js';
import { toPixelEvents } from './claude-adapter.js';
import type { RawJsonlEvent } from './types.js';

export function parseJsonlLine(line: string, sessionId: string, agentId: string): RawJsonlEvent | null {
  try {
    const parsed = JSON.parse(line) as RawJsonlEvent;
    return {
      ...parsed,
      input: {
        ...(parsed.input ?? {}),
        _sessionId: sessionId,
        _agentId: agentId,
      },
    };
  } catch {
    return null;
  }
}

export function transformToPixelEvents(raw: RawJsonlEvent): PixelEvent[] {
  return toPixelEvents(raw);
}
