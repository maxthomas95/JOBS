import { createSessionEvent, createToolEvent, createActivityEvent, createSummaryEvent } from './bridge/pixel-events.js';
import type { PixelEvent } from '../src/types/events.js';

export class MockEventGenerator {
  private interval: NodeJS.Timeout | null = null;
  private sessionStarted = false;
  private readonly sessionId = 'mock-session';
  private readonly agentId = 'mock-session';
  private cursor = 0;

  start(callback: (event: PixelEvent) => void): void {
    this.stop();
    const steps: Array<() => PixelEvent> = [
      () => createSessionEvent(this.sessionId, 'started', { agentId: this.agentId }),
      // Thinking at whiteboard
      () => createActivityEvent(this.sessionId, this.agentId, Date.now(), 'thinking'),
      // Search/research at library
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Grep', status: 'started', context: 'handleAuth' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Grep', status: 'completed' }),
      // Read file at desk
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Read', status: 'started', context: 'config.ts' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Read', status: 'completed' }),
      // Responding at desk
      () => createActivityEvent(this.sessionId, this.agentId, Date.now(), 'responding'),
      // Write file at desk
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Write', status: 'started', context: 'middleware.ts' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Write', status: 'completed' }),
      // Terminal
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Bash', status: 'started', context: 'run test suite' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Bash', status: 'completed' }),
      // Web search at library
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'WebSearch', status: 'started', context: 'pixi.js docs' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'WebSearch', status: 'completed' }),
      // Spawn sub-agent (delegating at desk)
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Task', status: 'started', context: 'Explore' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Task', status: 'completed' }),
      // User prompt → waiting for human
      () => createActivityEvent(this.sessionId, this.agentId, Date.now(), 'user_prompt'),
      // Error scenario — tool error
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Bash', status: 'started', context: 'npm build' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Bash', status: 'error' }),
      // Think again, then code
      () => createActivityEvent(this.sessionId, this.agentId, Date.now(), 'thinking'),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Edit', status: 'started', context: 'fix.ts' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'Edit', status: 'completed' }),
      // Summary → cooling at coffee
      () => createSummaryEvent(this.sessionId, Date.now()),
    ];

    this.interval = setInterval(() => {
      if (!this.sessionStarted) {
        callback(steps[0]());
        this.sessionStarted = true;
        this.cursor = 1;
        return;
      }
      callback(steps[this.cursor]());
      this.cursor += 1;
      if (this.cursor >= steps.length) {
        this.cursor = 1;
      }
    }, 3000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
