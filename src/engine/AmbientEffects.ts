import { Container, Graphics } from 'pixi.js';
import type { Agent, AgentState } from '../types/agent.js';
import { STATIONS, TILE_SIZE, tileToWorld } from '../types/agent.js';

/** Agent states that indicate the agent is actively working at their desk. */
const DESK_ACTIVE_STATES: Set<AgentState> = new Set([
  'coding',
  'reading',
  'terminal',
  'searching',
  'thinking',
]);

// --- Screen glow constants ---
const GLOW_COLOR = 0x42a5f5;
const GLOW_ALPHA_MIN = 0.1;
const GLOW_ALPHA_MAX = 0.3;

// --- Coffee steam constants ---
const STEAM_MAX_PARTICLES = 8;
const STEAM_LIFETIME = 2; // seconds
const STEAM_SPAWN_INTERVAL = 0.6; // seconds between spawns (~1-2 per second)
const STEAM_RISE_SPEED = 8; // px/sec upward
const STEAM_WOBBLE_AMPLITUDE = 1.5; // px horizontal wobble

interface SteamParticle {
  graphic: Graphics;
  age: number;
  startX: number;
  startY: number;
  radius: number;
  wobbleOffset: number;
}

export class AmbientEffects {
  private readonly container: Container;

  // Desk glow
  private readonly deskGlows: Graphics[] = [];

  // Coffee steam
  private readonly steamParticles: SteamParticle[] = [];
  private steamSpawnTimer = 0;
  private steamContainer: Container | null = null;

  // Phase accumulator for sin wave
  private phase = 0;

  constructor(container: Container) {
    this.container = container;
  }

  init(): void {
    this.initDeskGlows();
    this.initSteam();
  }

  update(deltaSeconds: number, agents: Map<string, Agent>): void {
    this.phase += deltaSeconds;
    this.updateDeskGlows(agents);
    this.updateSteam(deltaSeconds, agents);
  }

  destroy(): void {
    for (const glow of this.deskGlows) {
      glow.destroy();
    }
    this.deskGlows.length = 0;

    for (const p of this.steamParticles) {
      p.graphic.destroy();
    }
    this.steamParticles.length = 0;
    this.steamContainer?.destroy();
  }

  // ─── Desk Glow ────────────────────────────────────────────

  private initDeskGlows(): void {
    for (const desk of STATIONS.desks) {
      const glow = new Graphics();
      // Draw the glow rectangle at the same position as the monitor in TileMap
      const monitorX = desk.x * TILE_SIZE + 3;
      const monitorY = desk.y * TILE_SIZE + 3;
      const monitorW = TILE_SIZE - 6;
      const monitorH = TILE_SIZE - 6;
      glow.rect(monitorX, monitorY, monitorW, monitorH).fill(GLOW_COLOR);
      glow.alpha = 0;
      glow.visible = false;
      this.container.addChild(glow);
      this.deskGlows.push(glow);
    }
  }

  private updateDeskGlows(agents: Map<string, Agent>): void {
    // Build a set of active desk indices
    const activeDeskIndices = new Set<number>();
    for (const agent of agents.values()) {
      if (agent.deskIndex !== null && DESK_ACTIVE_STATES.has(agent.state)) {
        activeDeskIndices.add(agent.deskIndex);
      }
    }

    for (let i = 0; i < this.deskGlows.length; i++) {
      const glow = this.deskGlows[i];
      if (activeDeskIndices.has(i)) {
        glow.visible = true;
        // Sin wave pulse between GLOW_ALPHA_MIN and GLOW_ALPHA_MAX
        // Each desk gets a slightly different phase offset so they don't all pulse in sync
        const t = (Math.sin(this.phase * 2 + i * 0.7) + 1) / 2;
        glow.alpha = GLOW_ALPHA_MIN + (GLOW_ALPHA_MAX - GLOW_ALPHA_MIN) * t;
      } else {
        glow.visible = false;
      }
    }
  }

  // ─── Coffee Steam ────────────────────────────────────────

  private initSteam(): void {
    this.steamContainer = new Container();
    this.container.addChild(this.steamContainer);
  }

  private updateSteam(deltaSeconds: number, agents: Map<string, Agent>): void {
    if (!this.steamContainer) return;

    // Check if any agent is cooling (at the coffee station)
    let hasCoolingAgent = false;
    for (const agent of agents.values()) {
      if (agent.state === 'cooling') {
        hasCoolingAgent = true;
        break;
      }
    }

    // Spawn new particles if someone is at coffee
    if (hasCoolingAgent) {
      this.steamSpawnTimer -= deltaSeconds;
      if (this.steamSpawnTimer <= 0 && this.steamParticles.length < STEAM_MAX_PARTICLES) {
        this.spawnSteamParticle();
        this.steamSpawnTimer = STEAM_SPAWN_INTERVAL;
      }
    }

    // Update existing particles
    for (let i = this.steamParticles.length - 1; i >= 0; i--) {
      const p = this.steamParticles[i];
      p.age += deltaSeconds;

      if (p.age >= STEAM_LIFETIME) {
        p.graphic.destroy();
        this.steamParticles.splice(i, 1);
        continue;
      }

      // Rise upward
      const progress = p.age / STEAM_LIFETIME;
      const y = p.startY - STEAM_RISE_SPEED * p.age;
      const x = p.startX + Math.sin(p.age * 3 + p.wobbleOffset) * STEAM_WOBBLE_AMPLITUDE;

      // Fade out
      p.graphic.alpha = 0.5 * (1 - progress);
      p.graphic.x = x;
      p.graphic.y = y;
    }
  }

  private spawnSteamParticle(): void {
    if (!this.steamContainer) return;

    const coffeeWorld = tileToWorld(STATIONS.coffee);
    // Spawn from just above the coffee machine, with slight horizontal randomness
    const startX = coffeeWorld.x + (Math.random() - 0.5) * 6;
    const startY = coffeeWorld.y - TILE_SIZE * 0.5;
    const radius = 1 + Math.random();

    const graphic = new Graphics();
    graphic.circle(0, 0, radius).fill({ color: 0xdddddd, alpha: 1 });
    graphic.x = startX;
    graphic.y = startY;
    graphic.alpha = 0.5;
    this.steamContainer.addChild(graphic);

    this.steamParticles.push({
      graphic,
      age: 0,
      startX,
      startY,
      radius,
      wobbleOffset: Math.random() * Math.PI * 2,
    });
  }
}
