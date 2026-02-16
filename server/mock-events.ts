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
      // Waiting for human input
      () => createActivityEvent(this.sessionId, this.agentId, Date.now(), 'waiting'),
      // Needs approval (permission prompt)
      () => createActivityEvent(this.sessionId, this.agentId, Date.now(), 'needsApproval'),
      // Compacting memory
      () => createActivityEvent(this.sessionId, this.agentId, Date.now(), 'compacting'),
      // User prompt resumes → thinking
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

/**
 * Mock event generator for supervisor/team scenarios.
 * Creates a parent agent that spawns 2 sub-agents, then monitors them.
 * Demonstrates: delegation, patrol, check-in, waiting-on-team, and child completion.
 */
export class SupervisorMockGenerator {
  private interval: NodeJS.Timeout | null = null;
  private cursor = 0;
  private readonly parentId = 'mock-supervisor';
  private readonly child1Id = 'mock-child-1';
  private readonly child2Id = 'mock-child-2';
  private readonly project = 'mock-supervisor';

  start(callback: (event: PixelEvent) => void): void {
    this.stop();

    // Pre-built timeline: parent starts, works, delegates to 2 children,
    // children work independently, one finishes, then the other
    const steps: Array<() => PixelEvent> = [
      // === Parent starts and does initial work ===
      () => createSessionEvent(this.parentId, 'started', { agentId: this.parentId, project: this.project }),
      () => createActivityEvent(this.parentId, this.parentId, Date.now(), 'thinking'),
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Read', status: 'started', context: 'VISION.md' }),
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Read', status: 'completed' }),
      () => createActivityEvent(this.parentId, this.parentId, Date.now(), 'responding'),

      // === Parent delegates to child 1 (researcher) ===
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Task', status: 'started', context: 'researcher' }),
      // Child 1 starts (session manager will link via pendingSpawn)
      () => createSessionEvent(this.child1Id, 'started', { agentId: this.child1Id, project: this.project }),
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Task', status: 'completed' }),

      // === Parent delegates to child 2 (builder) ===
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Task', status: 'started', context: 'builder' }),
      () => createSessionEvent(this.child2Id, 'started', { agentId: this.child2Id, project: this.project }),
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Task', status: 'completed' }),

      // === Parent waits (cooling/idle while children work) ===
      () => createSummaryEvent(this.parentId, Date.now()),

      // === Child 1 works: research cycle ===
      () => createActivityEvent(this.child1Id, this.child1Id, Date.now(), 'thinking'),
      () => createToolEvent(this.child1Id, this.child1Id, Date.now(), { tool: 'Grep', status: 'started', context: 'useOfficeStore' }),
      () => createToolEvent(this.child1Id, this.child1Id, Date.now(), { tool: 'Grep', status: 'completed' }),
      () => createToolEvent(this.child1Id, this.child1Id, Date.now(), { tool: 'Read', status: 'started', context: 'AgentSprite.ts' }),
      () => createToolEvent(this.child1Id, this.child1Id, Date.now(), { tool: 'Read', status: 'completed' }),

      // === Child 2 works: building cycle ===
      () => createActivityEvent(this.child2Id, this.child2Id, Date.now(), 'thinking'),
      () => createToolEvent(this.child2Id, this.child2Id, Date.now(), { tool: 'Write', status: 'started', context: 'patrol.ts' }),
      () => createToolEvent(this.child2Id, this.child2Id, Date.now(), { tool: 'Write', status: 'completed' }),
      () => createToolEvent(this.child2Id, this.child2Id, Date.now(), { tool: 'Bash', status: 'started', context: 'run tests' }),
      () => createToolEvent(this.child2Id, this.child2Id, Date.now(), { tool: 'Bash', status: 'completed' }),

      // === Child 1 needs approval (permission prompt) ===
      () => createActivityEvent(this.child1Id, this.child1Id, Date.now(), 'needsApproval'),
      // Approved → continues research
      () => createToolEvent(this.child1Id, this.child1Id, Date.now(), { tool: 'WebSearch', status: 'started', context: 'pixi.js patrol' }),
      () => createToolEvent(this.child1Id, this.child1Id, Date.now(), { tool: 'WebSearch', status: 'completed' }),
      () => createActivityEvent(this.child1Id, this.child1Id, Date.now(), 'responding'),

      // === Parent compacts memory while waiting ===
      () => createActivityEvent(this.parentId, this.parentId, Date.now(), 'compacting'),

      // === Child 2 continues building ===
      () => createToolEvent(this.child2Id, this.child2Id, Date.now(), { tool: 'Edit', status: 'started', context: 'HUD.tsx' }),
      () => createToolEvent(this.child2Id, this.child2Id, Date.now(), { tool: 'Edit', status: 'completed' }),

      // === Child 1 finishes ===
      () => createSummaryEvent(this.child1Id, Date.now()),
      () => createSessionEvent(this.child1Id, 'ended', { agentId: this.child1Id, project: this.project }),

      // === Parent reacts to child 1 finishing ===
      () => createActivityEvent(this.parentId, this.parentId, Date.now(), 'thinking'),
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Read', status: 'started', context: 'research results' }),
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Read', status: 'completed' }),

      // === Child 2 finishes ===
      () => createSummaryEvent(this.child2Id, Date.now()),
      () => createSessionEvent(this.child2Id, 'ended', { agentId: this.child2Id, project: this.project }),

      // === Parent wraps up ===
      () => createActivityEvent(this.parentId, this.parentId, Date.now(), 'responding'),
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Write', status: 'started', context: 'summary.md' }),
      () => createToolEvent(this.parentId, this.parentId, Date.now(), { tool: 'Write', status: 'completed' }),
      () => createSummaryEvent(this.parentId, Date.now()),
    ];

    this.interval = setInterval(() => {
      if (this.cursor >= steps.length) {
        // Loop: restart from the delegation phase (skip initial setup)
        this.cursor = 5;
      }
      callback(steps[this.cursor]());
      this.cursor += 1;
    }, 2500);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
