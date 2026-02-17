import { Application, Container } from 'pixi.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { spritePositions } from './AgentSprite.js';

/** Custom events dispatched on window for HUD to listen to. */
const ENTER_EVENT = 'follow-enter';
const EXIT_EVENT = 'follow-exit';

/** Target zoom when following an agent. */
const FOLLOW_ZOOM = 1.8;
/** Lerp factor per frame for smooth camera transitions. */
const LERP_FACTOR = 0.02;
/** Faster lerp when snapping back to default view. */
const EXIT_LERP_FACTOR = 0.05;

export class FollowMode {
  active = false;
  followedAgentId: string | null = null;
  private elapsedTime = 0;

  /** Default stage transform to restore on exit. */
  private defaultScale = 1;
  private defaultPivotX = 0;
  private defaultPivotY = 0;
  private defaultPositionX = 0;
  private defaultPositionY = 0;

  /** Whether we're in the exit transition (lerping back to default). */
  private exiting = false;

  /** Store subscription cleanup. */
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly app: Application,
    private readonly stage: Container,
  ) {
    // Capture default stage transform
    this.defaultScale = stage.scale.x;
    this.defaultPivotX = stage.pivot.x;
    this.defaultPivotY = stage.pivot.y;
    this.defaultPositionX = stage.position.x;
    this.defaultPositionY = stage.position.y;

    // Subscribe to store changes for followedAgentId
    this.unsubscribe = useOfficeStore.subscribe(
      (state) => state.followedAgentId,
      (followedId) => {
        if (followedId) {
          this.enter(followedId);
        } else {
          this.exit();
        }
      },
    );
  }

  update(deltaSeconds: number): void {
    this.elapsedTime += deltaSeconds;

    if (this.exiting) {
      this.lerpToDefault();
      return;
    }

    if (!this.active || !this.followedAgentId) return;

    // Check if agent still exists
    const pos = spritePositions.get(this.followedAgentId);
    if (!pos) {
      // Agent disconnected — auto-unfollow via store
      useOfficeStore.getState().unfollowAgent();
      return;
    }

    this.animateCamera(pos.x, pos.y);
  }

  private enter(agentId: string): void {
    if (this.active && this.followedAgentId === agentId) return;
    this.followedAgentId = agentId;
    this.active = true;
    this.exiting = false;
    window.dispatchEvent(new CustomEvent(ENTER_EVENT, { detail: { agentId } }));
  }

  private exit(): void {
    if (!this.active) return;
    this.active = false;
    this.followedAgentId = null;
    this.exiting = true;

    window.dispatchEvent(new CustomEvent(EXIT_EVENT));
  }

  destroy(): void {
    this.unsubscribe?.();
    if (this.active) {
      this.active = false;
      this.followedAgentId = null;
      // Restore stage transform immediately
      this.stage.scale.set(this.defaultScale);
      this.stage.pivot.set(this.defaultPivotX, this.defaultPivotY);
      this.stage.position.set(this.defaultPositionX, this.defaultPositionY);
    }
  }

  private animateCamera(targetWorldX: number, targetWorldY: number): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;

    // Add gentle drift around the followed agent
    const driftX = Math.sin(this.elapsedTime * 0.12) * 4;
    const driftY = Math.cos(this.elapsedTime * 0.09) * 3;

    const targetPivotX = targetWorldX + driftX;
    const targetPivotY = targetWorldY + driftY;
    const targetScale = FOLLOW_ZOOM;
    const targetPosX = screenW / 2;
    const targetPosY = screenH / 2;

    const s = this.stage;
    s.scale.x += (targetScale - s.scale.x) * LERP_FACTOR;
    s.scale.y += (targetScale - s.scale.y) * LERP_FACTOR;
    s.pivot.x += (targetPivotX - s.pivot.x) * LERP_FACTOR;
    s.pivot.y += (targetPivotY - s.pivot.y) * LERP_FACTOR;
    s.position.x += (targetPosX - s.position.x) * LERP_FACTOR;
    s.position.y += (targetPosY - s.position.y) * LERP_FACTOR;
  }

  /** Smoothly lerp back to default camera position on exit. */
  private lerpToDefault(): void {
    const s = this.stage;
    const f = EXIT_LERP_FACTOR;

    s.scale.x += (this.defaultScale - s.scale.x) * f;
    s.scale.y += (this.defaultScale - s.scale.y) * f;
    s.pivot.x += (this.defaultPivotX - s.pivot.x) * f;
    s.pivot.y += (this.defaultPivotY - s.pivot.y) * f;
    s.position.x += (this.defaultPositionX - s.position.x) * f;
    s.position.y += (this.defaultPositionY - s.position.y) * f;

    // Stop exiting once close enough
    const dist =
      Math.abs(s.scale.x - this.defaultScale) +
      Math.abs(s.pivot.x - this.defaultPivotX) +
      Math.abs(s.pivot.y - this.defaultPivotY) +
      Math.abs(s.position.x - this.defaultPositionX) +
      Math.abs(s.position.y - this.defaultPositionY);

    if (dist < 0.5) {
      s.scale.set(this.defaultScale);
      s.pivot.set(this.defaultPivotX, this.defaultPivotY);
      s.position.set(this.defaultPositionX, this.defaultPositionY);
      this.exiting = false;
    }
  }
}
