import type { PixelEvent } from '../../src/types/events.js';
import {
  createActivityEvent,
  createSummaryEvent,
  createToolEvent,
} from './pixel-events.js';
import type { RawContentBlock, RawJsonlEvent } from './types.js';

/** Track toolUseId → toolName so we can label completion events */
const toolNameCache = new Map<string, string>();

function getMeta(raw: RawJsonlEvent): { sessionId: string; agentId: string; timestamp: number } {
  const sessionId = String(raw.input?._sessionId ?? raw.toolUseId ?? 'unknown');
  const agentId = String(raw.input?._agentId ?? sessionId);
  const timestamp = raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now();
  return { sessionId, agentId, timestamp };
}

function extractSafeContext(toolName: string, input: Record<string, unknown> | undefined): string | null {
  if (!input) {
    return null;
  }
  const normalized = toolName.toLowerCase();

  if (normalized.includes('read') || normalized.includes('write') || normalized.includes('edit')) {
    const filePath = input.file_path;
    if (typeof filePath === 'string') {
      const parts = filePath.split(/[\\/]/g);
      return parts[parts.length - 1] ?? null;
    }
    return null;
  }

  if (normalized.includes('bash')) {
    return typeof input.description === 'string' ? input.description : null;
  }

  if (normalized.includes('grep') || normalized.includes('glob')) {
    return typeof input.pattern === 'string' ? input.pattern : null;
  }

  if (normalized.includes('task')) {
    // Prefer the Claude Code-assigned agent name (e.g. "m2-builder")
    if (typeof input.name === 'string') return input.name;
    if (typeof input.description === 'string') return input.description;
    return typeof input.subagent_type === 'string' ? input.subagent_type : null;
  }

  return null;
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
      const context = extractSafeContext(tool, parsed.input);
      // Cache tool name for matching on completion
      if (parsed.id) {
        toolNameCache.set(parsed.id, tool);
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
      const tool = toolNameCache.get(parsed.tool_use_id) ?? 'unknown_tool';
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
