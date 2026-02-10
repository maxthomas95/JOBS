import { AnimatedSprite, Container, Graphics, Spritesheet, Texture, SCALE_MODES } from 'pixi.js';
import type { Agent } from '../types/agent.js';
import type { Point } from '../types/agent.js';
import { characterData } from '../assets/sprites/characters.js';
import { findPath } from './Pathfinder.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import atlasUrl from '../assets/sprites/32x32folk.png';

type Direction = 'up' | 'down' | 'left' | 'right';

interface AgentVisual {
  sprite: AnimatedSprite;
  shadow: Graphics;
  phase: number;
  /** Remaining waypoints the agent is walking toward. */
  waypoints: Point[];
  /** The targetPosition that generated the current waypoints (for change detection). */
  pathTarget: Point | null;
}

export class AgentSpriteManager {
  private readonly sprites = new Map<string, AgentVisual>();
  private readonly spritesheets = new Map<number, Spritesheet>();
  private useFallbackSprites = false;

  constructor(private readonly container: Container) {}

  async loadSpritesheets(): Promise<void> {
    try {
      const texture = Texture.from(atlasUrl);
      texture.source.scaleMode = SCALE_MODES.NEAREST;
      for (let i = 0; i < 8; i += 1) {
        const sheet = new Spritesheet(texture, characterData[i]);
        await sheet.parse();
        if (!sheet.textures['down_1']) {
          throw new Error(`missing expected frame for character ${i}`);
        }
        this.spritesheets.set(i, sheet);
      }
    } catch (error) {
      this.useFallbackSprites = true;
      // eslint-disable-next-line no-console
      console.error('[sprites] falling back to debug squares:', (error as Error).message);
    }
  }

  addAgent(agent: Agent): void {
    if (this.sprites.has(agent.id)) {
      return;
    }

    // Shadow ellipse for contrast against any background
    const shadow = new Graphics();
    shadow.ellipse(0, 0, 8, 3).fill({ color: 0x000000, alpha: 0.35 });
    shadow.x = agent.position.x;
    shadow.y = agent.position.y + 4;
    this.container.addChild(shadow);

    const textures = this.useFallbackSprites
      ? [Texture.WHITE]
      : this.getWalkTextures(agent.characterIndex, 'down');
    const sprite = new AnimatedSprite(textures);
    sprite.anchor.set(0.5, 0.75);
    sprite.x = agent.position.x;
    sprite.y = agent.position.y;
    sprite.animationSpeed = 0.12;
    if (this.useFallbackSprites) {
      sprite.tint = 0xff4d4d;
      sprite.width = 18;
      sprite.height = 24;
    }
    sprite.play();
    this.container.addChild(sprite);
    this.sprites.set(agent.id, { sprite, shadow, phase: 0, waypoints: [], pathTarget: null });
  }

  removeAgent(id: string): void {
    const visual = this.sprites.get(id);
    if (!visual) {
      return;
    }
    visual.shadow.destroy();
    visual.sprite.destroy();
    this.sprites.delete(id);
  }

  update(deltaSeconds: number, agents: Map<string, Agent>): void {
    const focusedId = useOfficeStore.getState().focusedAgentId;

    for (const [id, agent] of agents.entries()) {
      const visual = this.sprites.get(id);
      if (!visual) {
        continue;
      }
      const sprite = visual.sprite;

      if (agent.targetPosition) {
        // Recompute path if the target changed
        if (
          !visual.pathTarget ||
          visual.pathTarget.x !== agent.targetPosition.x ||
          visual.pathTarget.y !== agent.targetPosition.y
        ) {
          visual.pathTarget = { x: agent.targetPosition.x, y: agent.targetPosition.y };
          const path = findPath({ x: sprite.x, y: sprite.y }, agent.targetPosition);
          visual.waypoints = path.length > 0 ? path : [{ x: agent.targetPosition.x, y: agent.targetPosition.y }];
        }

        if (visual.waypoints.length === 0) {
          this.applyIdlePose(agent, visual, deltaSeconds);
          continue;
        }

        const wp = visual.waypoints[0];
        const dx = wp.x - sprite.x;
        const dy = wp.y - sprite.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 1) {
          sprite.x = wp.x;
          sprite.y = wp.y;
          visual.waypoints.shift();

          if (visual.waypoints.length === 0) {
            this.applyIdlePose(agent, visual, deltaSeconds);
          }
        } else {
          const speed = 35;
          const nx = dx / dist;
          const ny = dy / dist;
          sprite.x += nx * speed * deltaSeconds;
          sprite.y += ny * speed * deltaSeconds;
          const dir: Direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
          sprite.textures = this.getWalkTextures(agent.characterIndex, dir);
          if (!sprite.playing) {
            sprite.play();
          }
        }
      }

      // Keep shadow tracking the sprite
      visual.shadow.x = sprite.x;
      visual.shadow.y = sprite.y + 4;

      // Base scale + focus highlight pulse
      const BASE_SCALE = 1.4;
      if (id === focusedId) {
        const pulse = BASE_SCALE + Math.sin(visual.phase * 4) * 0.2;
        sprite.scale.set(pulse, pulse);
      } else {
        sprite.scale.set(BASE_SCALE, BASE_SCALE);
      }
    }
  }

  private applyIdlePose(agent: Agent, visual: AgentVisual, deltaSeconds: number): void {
    const sprite = visual.sprite;
    visual.phase += deltaSeconds * 8;

    // Reset tint in case it was set by a previous error state
    sprite.tint = 0xffffff;

    if (agent.state === 'thinking') {
      sprite.textures = [this.getFrame(agent.characterIndex, 'up_1')];
      sprite.stop();
      sprite.x += Math.sin(visual.phase) * 0.15;
      return;
    }

    if (agent.state === 'terminal') {
      sprite.textures = [this.getFrame(agent.characterIndex, 'right_1')];
      sprite.stop();
      sprite.y += Math.sin(visual.phase * 2) * 1;
      return;
    }

    if (agent.state === 'coding' || agent.state === 'reading') {
      sprite.textures = [this.getFrame(agent.characterIndex, 'down_1')];
      sprite.stop();
      sprite.y += Math.sin(visual.phase) * 1;
      return;
    }

    if (agent.state === 'searching') {
      sprite.textures = [this.getFrame(agent.characterIndex, 'left_1')];
      sprite.stop();
      sprite.x += Math.sin(visual.phase * 1.5) * 0.3;
      return;
    }

    if (agent.state === 'cooling') {
      sprite.textures = [this.getFrame(agent.characterIndex, 'down_1')];
      sprite.stop();
      sprite.y += Math.sin(visual.phase * 0.8) * 0.4;
      return;
    }

    if (agent.state === 'delegating') {
      sprite.textures = [this.getFrame(agent.characterIndex, 'right_1')];
      sprite.stop();
      return;
    }

    if (agent.state === 'error') {
      sprite.textures = [this.getFrame(agent.characterIndex, 'down_1')];
      sprite.stop();
      sprite.tint = Math.sin(visual.phase * 3) > 0 ? 0xff4444 : 0xffffff;
      return;
    }

    if (agent.state === 'waiting') {
      sprite.textures = [this.getFrame(agent.characterIndex, 'down_1')];
      sprite.stop();
      return;
    }

    // Default idle
    sprite.textures = [this.getFrame(agent.characterIndex, 'down_1')];
    sprite.stop();
  }

  private getWalkTextures(characterIndex: number, direction: Direction): Texture[] {
    return [
      this.getFrame(characterIndex, `${direction}_0`),
      this.getFrame(characterIndex, `${direction}_1`),
      this.getFrame(characterIndex, `${direction}_2`),
    ];
  }

  private getFrame(characterIndex: number, frameName: string): Texture {
    const sheet = this.spritesheets.get(characterIndex);
    return sheet?.textures[frameName] ?? Texture.WHITE;
  }
}
