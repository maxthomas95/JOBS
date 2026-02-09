import { AnimatedSprite, Container, Spritesheet, Texture, SCALE_MODES } from 'pixi.js';
import type { Agent } from '../types/agent.js';
import { characterData } from '../assets/sprites/characters.js';
import atlasUrl from '../assets/sprites/32x32folk.png';

type Direction = 'up' | 'down' | 'left' | 'right';

interface AgentVisual {
  sprite: AnimatedSprite;
  phase: number;
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
    this.sprites.set(agent.id, { sprite, phase: 0 });
  }

  removeAgent(id: string): void {
    const visual = this.sprites.get(id);
    if (!visual) {
      return;
    }
    visual.sprite.destroy();
    this.sprites.delete(id);
  }

  update(deltaSeconds: number, agents: Map<string, Agent>): void {
    for (const [id, agent] of agents.entries()) {
      const visual = this.sprites.get(id);
      if (!visual) {
        continue;
      }
      const sprite = visual.sprite;

      if (agent.targetPosition) {
        const dx = agent.targetPosition.x - sprite.x;
        const dy = agent.targetPosition.y - sprite.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 0.5) {
          sprite.x = agent.targetPosition.x;
          sprite.y = agent.targetPosition.y;
          this.applyIdlePose(agent, visual, deltaSeconds);
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
    }
  }

  private applyIdlePose(agent: Agent, visual: AgentVisual, deltaSeconds: number): void {
    const sprite = visual.sprite;
    visual.phase += deltaSeconds * 8;
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
