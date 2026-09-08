import type { PixelEvent } from '../../src/types/events.js';
import {
  createActivityEvent,
  createSummaryEvent,
  createToolEvent,
} from './pixel-events.js';
import type { RawContentBlock, RawJsonlEvent } from './types.js';
import { safeToolContext } from '../public-event.js';

/** Track toolUseId → toolName so we can label completion events */
const toolNameCache = new Map<string, { name: string; ts: number }>();

/** Remove cache entries older than 5 minutes */
export function cleanToolNameCache(): void {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, entry] of toolNameCache.entries()) {
    if (entry.ts < cutoff) {
      toolNameCache.delete(key);
    }
  }
}

function getMeta(raw: RawJsonlEvent): { sessionId: string; agentId: string; timestamp: number } {
  const sessionId = String(raw.input?._sessionId ?? raw.toolUseId ?? 'unknown');
  const agentId = String(raw.input?._agentId ?? sessionId);
  const timestamp = raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now();
  return { sessionId, agentId, timestamp };
}


function assistantEvents(raw: RawJsonlEvent): PixelEvent[] {
  const { sessionId, agentId, timestamp } = getMeta(raw);
  const blocks = raw.message?.content ?? [];
  const events: PixelEvent[] = [];

  // Check what block types are present to determine the best activity state.
  // A single JSONL line contains ALL blocks from one turn (thinking + text + tool_use).
  // Tool events are always emitted (for stats + state), but activity events (thinking/responding)
  // are only emitted when there are no tool_use blocks — otherwise the tool events already
  // set the correct state and the activity events would just fight them.
  let hasToolUse = false;
  for (const block of blocks) {
    if ((block as RawContentBlock).type === 'tool_use') {
      hasToolUse = true;
      break;
    }
  }

  for (const block of blocks) {
    const parsed = block as RawContentBlock;
    if (parsed.type === 'thinking') {
      // Only emit thinking activity if there are no tool_use blocks in this message.
      // When tools are present, the tool events determine the agent's state.
      if (!hasToolUse) {
        events.push(createActivityEvent(sessionId, agentId, timestamp, 'thinking'));
      }
    } else if (parsed.type === 'text') {
      // Only emit responding activity if there are no tool_use blocks.
      if (!hasToolUse) {
        events.push(createActivityEvent(sessionId, agentId, timestamp, 'responding'));
      }
    } else if (parsed.type === 'tool_use') {
      const tool = parsed.name ?? 'unknown_tool';
      const context = safeToolContext(tool, parsed.input);
      // Cache tool name for matching on completion
      if (parsed.id) {
        toolNameCache.set(parsed.id, { name: tool, ts: Date.now() });
      }
      events.push(
        createToolEvent(sessionId, agentId, timestamp, {
          tool,
          status: 'started',
          toolUseId: parsed.id,
          context,
        }),
      );
    }
  }

  return events;
}

function userEvents(raw: RawJsonlEvent): PixelEvent[] {
  const { sessionId, agentId, timestamp } = getMeta(raw);
  const blocks = raw.message?.content ?? [];
  const events: PixelEvent[] = [];

  for (const block of blocks) {
    const parsed = block as RawContentBlock;
    if (parsed.type === 'tool_result' && parsed.tool_use_id) {
      const tool = toolNameCache.get(parsed.tool_use_id)?.name ?? 'unknown_tool';
      const status = parsed.is_error ? 'error' : 'completed';
      events.push(
        createToolEvent(sessionId, agentId, timestamp, {
          tool,
          status,
          toolUseId: parsed.tool_use_id,
        }),
      );
      // Clean up cache entry
      toolNameCache.delete(parsed.tool_use_id);
    }
  }

  // If no tool_result blocks found, treat as human user prompt
  if (events.length === 0) {
    events.push(createActivityEvent(sessionId, agentId, timestamp, 'user_prompt'));
  }

  return events;
}

export function toPixelEvents(raw: RawJsonlEvent): PixelEvent[] {
  if (raw.type === 'assistant') {
    return assistantEvents(raw);
  }
  if (raw.type === 'user') {
    return userEvents(raw);
  }
  if (raw.type === 'summary') {
    const { sessionId, timestamp } = getMeta(raw);
    return [createSummaryEvent(sessionId, timestamp)];
  }
  return [];
}
