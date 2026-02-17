import { Application, Container, Ticker } from 'pixi.js';
import type { Agent } from '../types/agent.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { useDayNightStore } from '../state/useDayNightStore.js';
import { AgentSpriteManager, worldTransform } from './AgentSprite.js';
import { AmbientEffects } from './AmbientEffects.js';
import type { DayNightCycle } from './DayNightCycle.js';
import type { FollowMode } from './FollowMode.js';
import { audioManager } from '../audio/AudioManager.js';

export class AnimationController {
  private unsubscribe: (() => void) | null = null;
  private unsubscribeDayNight: (() => void) | null = null;
  private ticker: Ticker | null = null;
  private spriteManager: AgentSpriteManager | null = null;
  private ambientEffects: AmbientEffects | null = null;
  private followMode: FollowMode | null = null;
  /** Track previous agent states to detect transitions for one-shot sounds */
  private prevStates = new Map<string, string>();
  /** Track when agents entered 'entering' state (for footstep cutoff) */
  private enteringAt = new Map<string, number>();

  constructor(
    private readonly app: Application,
    private readonly layer: Container,
    private readonly ambientLayer: Container,
    private readonly dayNightCycle?: DayNightCycle,
    followMode?: FollowMode,
  ) {
    this.followMode = followMode ?? null;
  }

  async init(): Promise<void> {
    this.spriteManager = new AgentSpriteManager(this.layer);
    await this.spriteManager.loadSpritesheets();

    this.ambientEffects = new AmbientEffects(this.ambientLayer);
    this.ambientEffects.init();

    // Sync day/night cycle enabled state from store
    if (this.dayNightCycle) {
      this.dayNightCycle.enabled = useDayNightStore.getState().enabled;
      this.unsubscribeDayNight = useDayNightStore.subscribe(
        (state) => state.enabled,
        (enabled) => {
          if (this.dayNightCycle) {
            this.dayNightCycle.enabled = enabled;
          }
        },
      );
    }

    this.unsubscribe = useOfficeStore.subscribe(
      (state) => state.agents,
      (agents, previous) => {
        this.syncSprites(agents, previous);
      },
    );

    this.syncSprites(useOfficeStore.getState().agents, new Map());

    this.ticker = this.app.ticker;
    this.ticker.add(this.onTick);
  }

  getFollowMode(): FollowMode | null {
    return this.followMode;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribeDayNight?.();
    if (this.ticker) {
      this.ticker.remove(this.onTick);
    }
    this.ambientEffects?.destroy();
    this.followMode?.destroy();
  }

  private readonly onTick = (ticker: Ticker): void => {
    if (!this.spriteManager) {
      return;
    }
    const agents = useOfficeStore.getState().agents;
    const deltaSeconds = ticker.deltaMS / 1000;
    this.dayNightCycle?.update(deltaSeconds);
    this.ambientEffects?.update(deltaSeconds, agents);
    this.spriteManager.update(deltaSeconds, agents);
    this.updateAudioLoops(ticker.deltaMS, agents);

    // Sync world container transform for BubbleOverlay coordinate mapping
    const world = this.layer.parent;
    if (world) {
      worldTransform.scaleX = world.scale.x;
      worldTransform.scaleY = world.scale.y;
      worldTransform.pivotX = world.pivot.x;
      worldTransform.pivotY = world.pivot.y;
      worldTransform.posX = world.position.x;
      worldTransform.posY = world.position.y;
    }
    this.followMode?.update(deltaSeconds);
  };

  private updateAudioLoops(_deltaMS: number, agents: Map<string, Agent>): void {
    if (!audioManager.enabled) return;

    let hasCoding = false;
    let hasCooling = false;
    let hasReading = false;
    let hasTerminal = false;
    let hasSearching = false;
    let hasEntering = false;
    let hasAny = false;

    for (const agent of agents.values()) {
      hasAny = true;

      // Detect state transitions for one-shot sounds
      const prev = this.prevStates.get(agent.id);
      if (prev !== agent.state) {
        this.prevStates.set(agent.id, agent.state);
        if (agent.state === 'waiting') {
          audioManager.play('waiting-ping');
        } else if (agent.state === 'needsApproval') {
          audioManager.play('waiting-ping');
        } else if (agent.state === 'compacting') {
          audioManager.startLoop('page-turning');
        } else if (agent.state === 'entering') {
          audioManager.play('door-bell');
          this.enteringAt.set(agent.id, Date.now());
        } else if (agent.state === 'leaving') {
          audioManager.play('door-bell-quiet');
        } else if (agent.state === 'error') {
          audioManager.play('error-alert');
        } else if (agent.state === 'cooling') {
          audioManager.play('task-complete');
        } else if (agent.state === 'delegating') {
          audioManager.play('delegation-chime');
        }
      }

      switch (agent.state) {
        case 'coding':
          hasCoding = true;
          break;
        case 'cooling':
        case 'waiting':
          hasCooling = true;
          break;
        case 'reading':
          hasReading = true;
          break;
        case 'terminal':
          hasTerminal = true;
          break;
        case 'searching':
          hasSearching = true;
          break;
        case 'entering': {
          const startedAt = this.enteringAt.get(agent.id);
          if (!startedAt || Date.now() - startedAt < 10000) {
            hasEntering = true;
          }
          break;
        }
      }
    }

    // Clean up tracking maps for removed agents
    for (const id of this.prevStates.keys()) {
      if (!agents.has(id)) {
        this.prevStates.delete(id);
        this.enteringAt.delete(id);
      }
    }

    // Keyboard typing loop while anyone is coding
    if (hasCoding) {
      audioManager.startLoop('keyboard-typing');
    } else {
      audioManager.stopLoop('keyboard-typing');
    }

    // Page turning loop while anyone is reading
    if (hasReading) {
      audioManager.startLoop('page-turning');
    } else {
      audioManager.stopLoop('page-turning');
    }

    // Terminal typing loop
    if (hasTerminal) {
      audioManager.startLoop('terminal-typing');
    } else {
      audioManager.stopLoop('terminal-typing');
    }

    // Paper rustling loop while searching
    if (hasSearching) {
      audioManager.startLoop('paper-rustling');
    } else {
      audioManager.stopLoop('paper-rustling');
    }

    // Footsteps while entering
    if (hasEntering) {
      audioManager.startLoop('footsteps');
    } else {
      audioManager.stopLoop('footsteps');
    }

    // Coffee brew loop
    if (hasCooling) {
      audioManager.startLoop('coffee-brew');
    } else {
      audioManager.stopLoop('coffee-brew');
    }

    // Ambient hum when any agents are present
    if (hasAny) {
      audioManager.startLoop('ambient-hum');
    } else {
      audioManager.stopLoop('ambient-hum');
    }
  }

  private syncSprites(agents: Map<string, Agent>, previous: Map<string, Agent>): void {
    if (!this.spriteManager) {
      return;
    }

    for (const id of previous.keys()) {
      if (!agents.has(id)) {
        this.spriteManager.removeAgent(id);
      }
    }

    for (const [id, agent] of agents.entries()) {
      if (!previous.has(id)) {
        this.spriteManager.addAgent(agent);
      }
    }
  }
}
