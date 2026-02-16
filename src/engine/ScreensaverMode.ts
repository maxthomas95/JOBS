import { Application, Container } from 'pixi.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { spritePositions } from './AgentSprite.js';

/** Custom events dispatched on window for HUD to listen to. */
const ENTER_EVENT = 'screensaver-enter';
const EXIT_EVENT = 'screensaver-exit';
const TOGGLE_EVENT = 'screensaver-toggle';

/** Seconds of inactivity before auto-entering screensaver. */
const DEFAULT_IDLE_THRESHOLD = 60;

/** Target zoom when following agents. */
const AGENT_ZOOM = 1.8;
/** Lerp factor per frame for smooth camera transitions. */
const LERP_FACTOR = 0.02;

/** Tracks when the app started (for uptime display). */
const appStartTime = Date.now();

export class ScreensaverMode {
  active = false;
  private idleTimer = 0;
  private readonly idleThreshold: number;
  private lastAgentStates = new Map<string, string>();
  private elapsedTime = 0;

  /** Default stage transform to restore on exit. */
  private defaultScale = 1;
  private defaultPivotX = 0;
  private defaultPivotY = 0;
  private defaultPositionX = 0;
  private defaultPositionY = 0;

  /** Bound event handlers for cleanup. */
  private readonly onUserInput: () => void;
  private readonly onToggle: () => void;

  constructor(
    private readonly app: Application,
    private readonly stage: Container,
    idleThreshold?: number,
  ) {
    this.idleThreshold = idleThreshold ?? DEFAULT_IDLE_THRESHOLD;

    // Capture default stage transform
    this.defaultScale = stage.scale.x;
    this.defaultPivotX = stage.pivot.x;
    this.defaultPivotY = stage.pivot.y;
    this.defaultPositionX = stage.position.x;
    this.defaultPositionY = stage.position.y;

    this.onUserInput = () => {
      if (this.active) this.exit();
    };
    this.onToggle = () => this.toggle();

    window.addEventListener('mousemove', this.onUserInput);
    window.addEventListener('keydown', this.onUserInput);
    window.addEventListener('click', this.onUserInput);
    window.addEventListener(TOGGLE_EVENT, this.onToggle);
  }

  update(deltaSeconds: number): void {
    this.elapsedTime += deltaSeconds;

    if (!this.active) {
      // Idle detection: compare agent states
      const agents = useOfficeStore.getState().agents;
      let stateChanged = false;

      for (const [id, agent] of agents.entries()) {
        const prev = this.lastAgentStates.get(id);
        if (prev !== agent.state) {
          stateChanged = true;
        }
        this.lastAgentStates.set(id, agent.state);
      }
      // Clean removed agents
      for (const id of this.lastAgentStates.keys()) {
        if (!agents.has(id)) {
          this.lastAgentStates.delete(id);
          stateChanged = true;
        }
      }

      if (stateChanged) {
        this.idleTimer = 0;
      } else {
        this.idleTimer += deltaSeconds;
      }

      if (this.idleTimer >= this.idleThreshold) {
        this.enter();
      }
      return;
    }

    // Camera animation while active
    this.animateCamera(deltaSeconds);
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.idleTimer = 0;

    // Save current stage transform as defaults
    this.defaultScale = 1;
    this.defaultPivotX = 0;
    this.defaultPivotY = 0;
    this.defaultPositionX = 0;
    this.defaultPositionY = 0;

    window.dispatchEvent(new CustomEvent(ENTER_EVENT));
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.idleTimer = 0;

    // Restore stage transform
    this.stage.scale.set(this.defaultScale);
    this.stage.pivot.set(this.defaultPivotX, this.defaultPivotY);
    this.stage.position.set(this.defaultPositionX, this.defaultPositionY);

    window.dispatchEvent(new CustomEvent(EXIT_EVENT));
  }

  toggle(): void {
    if (this.active) {
      this.exit();
    } else {
      this.enter();
    }
  }

  /** Returns ambient stats text for overlay display. */
  getOverlayText(): string {
    const agents = useOfficeStore.getState().agents;
    const count = agents.size;
    const uptimeMs = Date.now() - appStartTime;
    const uptimeMin = Math.floor(uptimeMs / 60000);
    const hours = Math.floor(uptimeMin / 60);
    const mins = uptimeMin % 60;
    const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    const sessionWord = count === 1 ? 'session' : 'sessions';
    return `${count} ${sessionWord} | ${uptimeStr} uptime`;
  }

  destroy(): void {
    window.removeEventListener('mousemove', this.onUserInput);
    window.removeEventListener('keydown', this.onUserInput);
    window.removeEventListener('click', this.onUserInput);
    window.removeEventListener(TOGGLE_EVENT, this.onToggle);
    if (this.active) {
      this.exit();
    }
  }

  private animateCamera(_deltaSeconds: number): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;

    // Compute bounding box of active agents
    const positions = Array.from(spritePositions.values());

    if (positions.length > 0) {
      // Follow agent cluster
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // Add gentle drift around the center
      const driftX = Math.sin(this.elapsedTime * 0.1) * 8;
      const driftY = Math.cos(this.elapsedTime * 0.07) * 6;

      const targetPivotX = centerX + driftX;
      const targetPivotY = centerY + driftY;
      const targetScale = AGENT_ZOOM;
      const targetPosX = screenW / 2;
      const targetPosY = screenH / 2;

      // Lerp toward targets
      const s = this.stage;
      s.scale.x += (targetScale - s.scale.x) * LERP_FACTOR;
      s.scale.y += (targetScale - s.scale.y) * LERP_FACTOR;
      s.pivot.x += (targetPivotX - s.pivot.x) * LERP_FACTOR;
      s.pivot.y += (targetPivotY - s.pivot.y) * LERP_FACTOR;
      s.position.x += (targetPosX - s.position.x) * LERP_FACTOR;
      s.position.y += (targetPosY - s.position.y) * LERP_FACTOR;
    } else {
      // No agents: gentle sinusoidal pan across the office
      // Office is 320x240, pan slowly around the center area
      const panX = 160 + Math.sin(this.elapsedTime * 0.05) * 60;
      const panY = 120 + Math.cos(this.elapsedTime * 0.04) * 40;

      const targetScale = 1.5;
      const targetPosX = screenW / 2;
      const targetPosY = screenH / 2;

      const s = this.stage;
      s.scale.x += (targetScale - s.scale.x) * LERP_FACTOR;
      s.scale.y += (targetScale - s.scale.y) * LERP_FACTOR;
      s.pivot.x += (panX - s.pivot.x) * LERP_FACTOR;
      s.pivot.y += (panY - s.pivot.y) * LERP_FACTOR;
      s.position.x += (targetPosX - s.position.x) * LERP_FACTOR;
      s.position.y += (targetPosY - s.position.y) * LERP_FACTOR;
    }
  }
}
