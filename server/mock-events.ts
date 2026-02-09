import { createSessionEvent, createToolEvent, createActivityEvent } from './bridge/pixel-events.js';
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
      () => createActivityEvent(this.sessionId, this.agentId, Date.now(), 'thinking'),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'file_write', status: 'started' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'file_write', status: 'completed' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'terminal', status: 'started' }),
      () => createToolEvent(this.sessionId, this.agentId, Date.now(), { tool: 'terminal', status: 'completed' }),
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
    }, 5000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
