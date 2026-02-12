import { Application, Container, Ticker } from 'pixi.js';
import type { Agent } from '../types/agent.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { AgentSpriteManager } from './AgentSprite.js';
import { AmbientEffects } from './AmbientEffects.js';
import { audioManager } from '../audio/AudioManager.js';

export class AnimationController {
  private unsubscribe: (() => void) | null = null;
  private ticker: Ticker | null = null;
  private spriteManager: AgentSpriteManager | null = null;
  private ambientEffects: AmbientEffects | null = null;
  /** Accumulated time since last keyboard click (ms) */
  private keyClickAccum = 0;
  /** Next keyboard click threshold (ms) */
  private keyClickThreshold = 150;
  /** Accumulated time since last page flip (ms) */
  private pageFlipAccum = 0;
  private pageFlipThreshold = 800;
  /** Accumulated time since last terminal keystroke (ms) */
  private termKeyAccum = 0;
  private termKeyThreshold = 200;
  /** Accumulated time since last paper shuffle (ms) */
  private shuffleAccum = 0;
  private shuffleThreshold = 600;

  constructor(
    private readonly app: Application,
    private readonly layer: Container,
    private readonly ambientLayer: Container,
  ) {}

  async init(): Promise<void> {
    this.spriteManager = new AgentSpriteManager(this.layer);
    await this.spriteManager.loadSpritesheets();

    this.ambientEffects = new AmbientEffects(this.ambientLayer);
    this.ambientEffects.init();

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

  destroy(): void {
    this.unsubscribe?.();
    if (this.ticker) {
      this.ticker.remove(this.onTick);
    }
    this.ambientEffects?.destroy();
  }

  private readonly onTick = (ticker: Ticker): void => {
    if (!this.spriteManager) {
      return;
    }
    const agents = useOfficeStore.getState().agents;
    const deltaSeconds = ticker.deltaMS / 1000;
    this.ambientEffects?.update(deltaSeconds, agents);
    this.spriteManager.update(deltaSeconds, agents);
    this.updateAudioLoops(ticker.deltaMS, agents);
  };

  private updateAudioLoops(deltaMS: number, agents: Map<string, Agent>): void {
    if (!audioManager.enabled) return;

    let hasCoding = false;
    let hasCooling = false;
    let hasReading = false;
    let hasTerminal = false;
    let hasSearching = false;
    let hasAny = false;

    for (const agent of agents.values()) {
      hasAny = true;
      if (agent.state === 'coding') hasCoding = true;
      if (agent.state === 'cooling' || agent.state === 'waiting') hasCooling = true;
      if (agent.state === 'reading') hasReading = true;
      if (agent.state === 'terminal') hasTerminal = true;
      if (agent.state === 'searching') hasSearching = true;
    }

    // Keyboard clicks: random interval 100-300ms while anyone is coding
    if (hasCoding) {
      this.keyClickAccum += deltaMS;
      if (this.keyClickAccum >= this.keyClickThreshold) {
        audioManager.play('keyboard-click');
        this.keyClickAccum = 0;
        this.keyClickThreshold = 100 + Math.random() * 200;
      }
    } else {
      this.keyClickAccum = 0;
    }

    // Page flips: slower interval while anyone is reading
    if (hasReading) {
      this.pageFlipAccum += deltaMS;
      if (this.pageFlipAccum >= this.pageFlipThreshold) {
        audioManager.play('page-flip');
        this.pageFlipAccum = 0;
        this.pageFlipThreshold = 600 + Math.random() * 600;
      }
    } else {
      this.pageFlipAccum = 0;
    }

    // Terminal keystrokes: medium interval
    if (hasTerminal) {
      this.termKeyAccum += deltaMS;
      if (this.termKeyAccum >= this.termKeyThreshold) {
        audioManager.play('terminal-keystroke');
        this.termKeyAccum = 0;
        this.termKeyThreshold = 150 + Math.random() * 250;
      }
    } else {
      this.termKeyAccum = 0;
    }

    // Paper shuffles: slower interval while searching
    if (hasSearching) {
      this.shuffleAccum += deltaMS;
      if (this.shuffleAccum >= this.shuffleThreshold) {
        audioManager.play('paper-shuffle');
        this.shuffleAccum = 0;
        this.shuffleThreshold = 500 + Math.random() * 700;
      }
    } else {
      this.shuffleAccum = 0;
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
