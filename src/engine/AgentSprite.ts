import { AnimatedSprite, Container, Graphics, Spritesheet, Text, TextStyle, Texture, SCALE_MODES } from 'pixi.js';
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
  /** Speech/thought bubble container above the sprite */
  bubble: Container | null;
  /** Current alpha of the bubble for fade transitions */
  bubbleAlpha: number;
  /** The activityText last shown in the bubble (for change detection) */
  bubbleText: string | null;
  /** Time-in-state label beneath the sprite */
  timeLabel: Text | null;
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
    this.sprites.set(agent.id, {
      sprite, shadow, phase: 0, waypoints: [], pathTarget: null,
      bubble: null, bubbleAlpha: 0, bubbleText: null, timeLabel: null,
    });
  }

  removeAgent(id: string): void {
    const visual = this.sprites.get(id);
    if (!visual) {
      return;
    }
    visual.shadow.destroy();
    visual.sprite.destroy();
    if (visual.bubble) visual.bubble.destroy();
    if (visual.timeLabel) visual.timeLabel.destroy();
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
        } else {
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
      }

      // Keep shadow tracking the sprite
      visual.shadow.x = sprite.x;
      visual.shadow.y = sprite.y + 4;

      // Base scale + focus highlight pulse + waitingForHuman treatment
      const BASE_SCALE = 1.4;
      if (agent.waitingForHuman) {
        // Pulsing yellow tint for waiting-for-human
        const tintPulse = Math.sin(visual.phase * 3);
        sprite.tint = tintPulse > 0 ? 0xffeb3b : 0xffffff;
        // More noticeable bob
        sprite.y += Math.sin(visual.phase * 1.5) * 1.5;
      }
      if (id === focusedId) {
        const pulse = BASE_SCALE + Math.sin(visual.phase * 4) * 0.2;
        sprite.scale.set(pulse, pulse);
      } else {
        sprite.scale.set(BASE_SCALE, BASE_SCALE);
      }

      // Update speech bubble and time label
      this.updateBubble(agent, visual, deltaSeconds);
      this.updateTimeLabel(agent, visual);
    }
  }

  private getBubbleColor(agent: Agent): { bg: number; text: number } {
    if (agent.waitingForHuman) return { bg: 0xffeb3b, text: 0x000000 };
    switch (agent.state) {
      case 'thinking': return { bg: 0x7c4dff, text: 0xffffff };
      case 'terminal': return { bg: 0x2ee65e, text: 0xffffff };
      case 'searching': return { bg: 0xffa726, text: 0xffffff };
      case 'coding':
      case 'reading': return { bg: 0x42a5f5, text: 0xffffff };
      case 'error': return { bg: 0xff4444, text: 0xffffff };
      case 'waiting': return { bg: 0xffeb3b, text: 0x000000 };
      default: return { bg: 0x555555, text: 0xffffff };
    }
  }

  private createBubble(displayText: string, colors: { bg: number; text: number }): Container {
    const bubble = new Container();

    const style = new TextStyle({
      fontSize: 7,
      fontFamily: 'monospace',
      fill: colors.text,
    });
    const label = new Text({ text: displayText, style });
    label.anchor.set(0.5, 0.5);

    const padX = 4;
    const padY = 2;
    const w = label.width + padX * 2;
    const h = label.height + padY * 2;

    const bg = new Graphics();
    // Rounded rectangle background
    bg.roundRect(-w / 2, -h / 2, w, h, 3).fill(colors.bg);
    // Small triangle pointing down
    bg.moveTo(-3, h / 2).lineTo(0, h / 2 + 3).lineTo(3, h / 2).fill(colors.bg);

    bubble.addChild(bg);
    bubble.addChild(label);

    return bubble;
  }

  private updateBubble(agent: Agent, visual: AgentVisual, deltaSeconds: number): void {
    // Determine what text to show
    let displayText: string | null = null;
    if (agent.waitingForHuman) {
      displayText = '? Waiting for you';
    } else if (agent.activityText) {
      displayText = agent.activityText.length > 15
        ? agent.activityText.slice(0, 14) + '\u2026'
        : agent.activityText;
    }

    const shouldShow = displayText !== null;
    const fadeSpeed = 6; // alpha units per second

    if (shouldShow) {
      // Create or recreate bubble if text changed
      if (visual.bubbleText !== displayText) {
        if (visual.bubble) {
          visual.bubble.destroy();
          visual.bubble = null;
        }
        const colors = this.getBubbleColor(agent);
        visual.bubble = this.createBubble(displayText!, colors);
        visual.bubble.alpha = visual.bubbleAlpha;
        this.container.addChild(visual.bubble);
        visual.bubbleText = displayText;
      }
      // Fade in
      visual.bubbleAlpha = Math.min(1, visual.bubbleAlpha + fadeSpeed * deltaSeconds);
    } else {
      // Fade out
      visual.bubbleAlpha = Math.max(0, visual.bubbleAlpha - fadeSpeed * deltaSeconds);
      if (visual.bubbleAlpha <= 0 && visual.bubble) {
        visual.bubble.destroy();
        visual.bubble = null;
        visual.bubbleText = null;
      }
    }

    // Position and apply alpha
    if (visual.bubble) {
      visual.bubble.x = visual.sprite.x;
      visual.bubble.y = visual.sprite.y - 22;
      visual.bubble.alpha = visual.bubbleAlpha;
    }
  }

  private updateTimeLabel(agent: Agent, visual: AgentVisual): void {
    const elapsed = (Date.now() - agent.stateChangedAt) / 1000;

    if (elapsed < 10) {
      // Hide if under 10s
      if (visual.timeLabel) {
        visual.timeLabel.destroy();
        visual.timeLabel = null;
      }
      return;
    }

    // Format time string
    const timeStr = elapsed < 60
      ? `${Math.floor(elapsed)}s`
      : `${Math.floor(elapsed / 60)}m`;

    // Color based on duration
    let color: number;
    if (elapsed > 300) {
      color = 0xff4444; // red
    } else if (elapsed > 60) {
      color = 0xffeb3b; // yellow
    } else {
      color = 0xffffff; // white
    }

    if (!visual.timeLabel) {
      const style = new TextStyle({
        fontSize: 5,
        fontFamily: 'monospace',
        fill: color,
      });
      visual.timeLabel = new Text({ text: timeStr, style });
      visual.timeLabel.anchor.set(0.5, 0);
      this.container.addChild(visual.timeLabel);
    } else {
      visual.timeLabel.text = timeStr;
      visual.timeLabel.style.fill = color;
    }

    visual.timeLabel.x = visual.sprite.x;
    visual.timeLabel.y = visual.sprite.y + 6;
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
