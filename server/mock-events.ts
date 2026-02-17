import { createSessionEvent, createToolEvent, createActivityEvent, createSummaryEvent } from './bridge/pixel-events.js';
import type { PixelEvent } from '../src/types/events.js';
import type { SessionManager } from './session-manager.js';
import type { WSServer } from './ws-server.js';

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

/**
 * Mock event generator for webhook scenarios (MOCK_EVENTS=webhook).
 * Simulates a CI pipeline agent and a Codex agent alongside a normal Claude session.
 */
export class WebhookMockGenerator {
  private interval: NodeJS.Timeout | null = null;
  private cursor = 0;
  private ciRegistered = false;
  private codexRegistered = false;
  private readonly claudeId = 'mock-claude-main';

  start(sessionManager: SessionManager, wsServer: WSServer): void {
    this.stop();

    const ciStates = ['running', 'building', 'testing', 'success'];
    const codexStates = ['thinking', 'running', 'reviewing', 'running'];
    let ciStateIdx = 0;
    let codexStateIdx = 0;

    // Start the Claude session via normal event flow
    const claudeStarted = createSessionEvent(this.claudeId, 'started', {
      agentId: this.claudeId,
      project: 'my-app',
    });
    sessionManager.handleEvent(claudeStarted);
    wsServer.broadcast(claudeStarted);
    wsServer.broadcastSnapshot();

    this.interval = setInterval(() => {
      this.cursor += 1;

      // Step 2: Register CI pipeline webhook agent
      if (this.cursor === 2 && !this.ciRegistered) {
        this.ciRegistered = true;
        sessionManager.registerWebhookAgent('gh-actions-42', {
          sourceName: 'GitHub Actions',
          sourceType: 'ci',
          project: 'my-app',
          state: 'running',
          activity: 'CI Pipeline #42',
          url: 'https://github.com/example/my-app/actions/runs/42',
        });
        wsServer.broadcastSnapshot();
        return;
      }

      // Step 4: Register Codex webhook agent
      if (this.cursor === 4 && !this.codexRegistered) {
        this.codexRegistered = true;
        sessionManager.registerWebhookAgent('codex-refactor', {
          sourceName: 'Codex CLI',
          sourceType: 'codex',
          project: 'my-app',
          state: 'thinking',
          activity: 'Refactoring auth module',
        });
        wsServer.broadcastSnapshot();
        return;
      }

      // Cycle Claude through work states
      const claudeSteps: Array<() => PixelEvent> = [
        () => createActivityEvent(this.claudeId, this.claudeId, Date.now(), 'thinking'),
        () => createToolEvent(this.claudeId, this.claudeId, Date.now(), { tool: 'Read', status: 'started', context: 'auth.ts' }),
        () => createToolEvent(this.claudeId, this.claudeId, Date.now(), { tool: 'Read', status: 'completed' }),
        () => createActivityEvent(this.claudeId, this.claudeId, Date.now(), 'responding'),
        () => createToolEvent(this.claudeId, this.claudeId, Date.now(), { tool: 'Edit', status: 'started', context: 'auth.ts' }),
        () => createToolEvent(this.claudeId, this.claudeId, Date.now(), { tool: 'Edit', status: 'completed' }),
        () => createToolEvent(this.claudeId, this.claudeId, Date.now(), { tool: 'Bash', status: 'started', context: 'npm test' }),
        () => createToolEvent(this.claudeId, this.claudeId, Date.now(), { tool: 'Bash', status: 'completed' }),
      ];
      const claudeEvent = claudeSteps[(this.cursor - 5) % claudeSteps.length]();
      sessionManager.handleEvent(claudeEvent);
      wsServer.broadcast(claudeEvent);

      // Cycle CI through states
      if (this.ciRegistered && this.cursor % 3 === 0) {
        const newState = ciStates[ciStateIdx % ciStates.length];
        ciStateIdx += 1;
        sessionManager.updateWebhookAgent('wh:gh-actions-42', newState, `Pipeline step: ${newState}`, null);
        wsServer.broadcastSnapshot();
      }

      // Cycle Codex through states
      if (this.codexRegistered && this.cursor % 4 === 0) {
        const newState = codexStates[codexStateIdx % codexStates.length];
        codexStateIdx += 1;
        sessionManager.updateWebhookAgent('wh:codex-refactor', newState, `Codex: ${newState}`, null);
        wsServer.broadcastSnapshot();
      }

      // Remove CI agent after it cycles through all states twice
      if (this.ciRegistered && ciStateIdx >= ciStates.length * 2) {
        sessionManager.removeWebhookAgent('wh:gh-actions-42');
        wsServer.broadcastSnapshot();
        this.ciRegistered = false;
        ciStateIdx = 0;
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
 * Mock event generator for multi-instance scenarios (MOCK_EVENTS=multi).
 * Creates agents across 2 machines with mixed types (Claude, webhook, Codex).
 */
export class MultiInstanceMockGenerator {
  private interval: NodeJS.Timeout | null = null;
  private cursor = 0;
  private readonly machine1Claude = 'mock-m1-claude';
  private machine1CiRegistered = false;

  start(sessionManager: SessionManager, wsServer: WSServer): void {
    this.stop();

    // Machine 1 is the local machine (already registered in SessionManager)
    // Machine 2 is simulated as a remote machine

    // Start Claude session on machine 1 (local)
    const m1Started = createSessionEvent(this.machine1Claude, 'started', {
      agentId: this.machine1Claude,
      project: 'frontend',
    });
    sessionManager.handleEvent(m1Started);
    wsServer.broadcast(m1Started);

    // Register a Codex agent on machine 2
    sessionManager.registerWebhookAgent('m2-codex-main', {
      sourceName: 'Codex CLI',
      sourceType: 'codex',
      project: 'backend',
      machine: 'dev-server-2',
      state: 'running',
      activity: 'Implementing API routes',
    });

    // Register a Claude-like agent on machine 2 (simulated remote)
    sessionManager.registerWebhookAgent('m2-claude-remote', {
      sourceName: 'Claude Code',
      sourceType: 'ci',
      project: 'backend',
      machine: 'dev-server-2',
      state: 'thinking',
      activity: 'Designing schema',
    });

    wsServer.broadcastSnapshot();

    const m1Steps: Array<() => PixelEvent> = [
      () => createActivityEvent(this.machine1Claude, this.machine1Claude, Date.now(), 'thinking'),
      () => createToolEvent(this.machine1Claude, this.machine1Claude, Date.now(), { tool: 'Read', status: 'started', context: 'App.tsx' }),
      () => createToolEvent(this.machine1Claude, this.machine1Claude, Date.now(), { tool: 'Read', status: 'completed' }),
      () => createActivityEvent(this.machine1Claude, this.machine1Claude, Date.now(), 'responding'),
      () => createToolEvent(this.machine1Claude, this.machine1Claude, Date.now(), { tool: 'Write', status: 'started', context: 'Dashboard.tsx' }),
      () => createToolEvent(this.machine1Claude, this.machine1Claude, Date.now(), { tool: 'Write', status: 'completed' }),
      () => createToolEvent(this.machine1Claude, this.machine1Claude, Date.now(), { tool: 'Bash', status: 'started', context: 'npm run build' }),
      () => createToolEvent(this.machine1Claude, this.machine1Claude, Date.now(), { tool: 'Bash', status: 'completed' }),
    ];

    const m2CodexStates = ['running', 'thinking', 'reviewing', 'testing', 'running'];
    const m2ClaudeStates = ['thinking', 'running', 'building', 'reviewing'];
    let m2CodexIdx = 0;
    let m2ClaudeIdx = 0;

    this.interval = setInterval(() => {
      this.cursor += 1;

      // Machine 1: Claude events
      const m1Event = m1Steps[(this.cursor - 1) % m1Steps.length]();
      sessionManager.handleEvent(m1Event);
      wsServer.broadcast(m1Event);

      // Machine 1: Deploy pipeline (appears at step 5)
      if (this.cursor === 5 && !this.machine1CiRegistered) {
        this.machine1CiRegistered = true;
        sessionManager.registerWebhookAgent('m1-deploy-prod', {
          sourceName: 'Deploy',
          sourceType: 'deploy',
          project: 'frontend',
          state: 'deploying',
          activity: 'Deploying to production',
          url: 'https://deploy.example.com/runs/99',
        });
        wsServer.broadcastSnapshot();
      }

      // Machine 2: Codex state cycling
      if (this.cursor % 3 === 0) {
        const state = m2CodexStates[m2CodexIdx % m2CodexStates.length];
        m2CodexIdx += 1;
        sessionManager.updateWebhookAgent('wh:m2-codex-main', state, `API routes: ${state}`, null);
        wsServer.broadcastSnapshot();
      }

      // Machine 2: Remote Claude-like agent state cycling
      if (this.cursor % 4 === 0) {
        const state = m2ClaudeStates[m2ClaudeIdx % m2ClaudeStates.length];
        m2ClaudeIdx += 1;
        sessionManager.updateWebhookAgent('wh:m2-claude-remote', state, `Schema: ${state}`, null);
        wsServer.broadcastSnapshot();
      }

      // Machine 1: Remove deploy agent after 8 cycles
      if (this.machine1CiRegistered && this.cursor > 13) {
        sessionManager.removeWebhookAgent('wh:m1-deploy-prod');
        wsServer.broadcastSnapshot();
        this.machine1CiRegistered = false;
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
