import type { PixelEvent } from '../../src/types/events.js';
import {
  createActivityEvent,
  createSummaryEvent,
  createToolEvent,
} from './pixel-events.js';
import type { RawContentBlock, RawJsonlEvent } from './types.js';

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
  let hasToolUse = false;

  for (const block of blocks) {
    const parsed = block as RawContentBlock;
    if (parsed.type === 'thinking') {
      events.push(createActivityEvent(sessionId, agentId, timestamp, 'thinking'));
    } else if (parsed.type === 'text') {
      events.push(createActivityEvent(sessionId, agentId, timestamp, 'responding'));
    } else if (parsed.type === 'tool_use') {
      hasToolUse = true;
      const tool = parsed.name ?? 'unknown_tool';
      const context = extractSafeContext(tool, parsed.input);
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

  // When the assistant turn ends (stop_reason "end_turn") with no pending
  // tool calls, Claude is done and waiting for human input.
  if (!hasToolUse && raw.message?.stop_reason === 'end_turn') {
    events.push(createActivityEvent(sessionId, agentId, timestamp, 'waiting'));
  }

  return events;
}

function userEvents(raw: RawJsonlEvent): PixelEvent[] {
  const { sessionId, agentId, timestamp } = getMeta(raw);
  if (raw.userType === 'tool_result') {
    const tool = raw.toolName ?? 'unknown_tool';
    const status = raw.isError ? 'error' : 'completed';
    return [
      createToolEvent(sessionId, agentId, timestamp, {
        tool,
        status,
        toolUseId: raw.toolUseId,
      }),
    ];
  }
  return [createActivityEvent(sessionId, agentId, timestamp, 'user_prompt')];
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
