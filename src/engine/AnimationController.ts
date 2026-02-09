import { Application, Container, Ticker } from 'pixi.js';
import type { Agent } from '../types/agent.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { AgentSpriteManager } from './AgentSprite.js';

export class AnimationController {
  private unsubscribe: (() => void) | null = null;
  private ticker: Ticker | null = null;
  private spriteManager: AgentSpriteManager | null = null;

  constructor(private readonly app: Application, private readonly layer: Container) {}

  async init(): Promise<void> {
    this.spriteManager = new AgentSpriteManager(this.layer);
    await this.spriteManager.loadSpritesheets();

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
  }

  private readonly onTick = (ticker: Ticker): void => {
    if (!this.spriteManager) {
      return;
    }
    const agents = useOfficeStore.getState().agents;
    this.spriteManager.update(ticker.deltaMS / 1000, agents);
  };

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
