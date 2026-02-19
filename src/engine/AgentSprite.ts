import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { AnimatedGIF } from '@pixi/gif';
import type { Agent } from '../types/agent.js';
import type { Point } from '../types/agent.js';
import { STATIONS, tileToWorld } from '../types/agent.js';
import { findPath } from './Pathfinder.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import claudeGifUrl from '../assets/claude.gif';
import openclawSvgUrl from '../assets/openclaw-mascot.svg';

/** Current sprite positions in world coordinates, updated every frame. Used by HTML bubble overlay. */
export const spritePositions = new Map<string, Point>();

/** Stage/world container transform, updated every frame. Used by BubbleOverlay for follow-mode zoom. */
export const worldTransform = { scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0, posX: 0, posY: 0 };

/** Active supervisor check-ins, keyed by supervisor agentId. Used by BubbleOverlay. */
export const supervisorCheckIns = new Map<string, { childId: string; message: string }>();

const CHECKIN_MESSAGES = ['Checking progress...', "How's it going?", 'Looking good!'];
const PASSIVE_STATES = new Set(['delegating', 'cooling', 'idle', 'waiting']);
const PATROL_PAUSE_DURATION = 3; // seconds at each child desk
const PATROL_COOLDOWN_DURATION = 30; // seconds between patrol cycles
const DOOR_WAIT_DURATION = 3; // seconds waiting at door for child
const ESCORT_HANDOFF_DURATION = 2; // seconds paused at child desk during handoff
const PACE_SPEED = 20; // px/sec for pacing (slower than normal 35)
const PACE_PAUSE_MIN = 3; // min seconds between pace targets
const PACE_PAUSE_MAX = 5; // max seconds between pace targets
const PACE_AREA = { minX: 7, maxX: 11, minY: 7, maxY: 9 }; // mid-office tile range

const SPRITE_SIZE = 32;
const OPENCLAW_SPRITE_SIZE = 24;

/** Check if an agent comes from an OpenClaw webhook source. */
function isOpenClawAgent(agent: Agent): boolean {
  if (agent.provider !== 'webhook') return false;
  const name = (agent.machineName ?? '').toLowerCase();
  const source = (agent.sourceName ?? '').toLowerCase();
  return name.includes('openclaw') || source.includes('openclaw');
}

/** Safe wrappers — AnimatedGIF has play/stop/playing, plain Sprite does not. */
function spritePlay(s: Sprite): void { if (s instanceof AnimatedGIF) s.play(); }
function spriteStop(s: Sprite): void { if (s instanceof AnimatedGIF) s.stop(); }
function spritePlaying(s: Sprite): boolean { return s instanceof AnimatedGIF ? s.playing : false; }

interface AgentVisual {
  sprite: Sprite;
  shadow: Graphics;
  /** Base render size (differs for OpenClaw vs Claude sprites). */
  baseSize: number;
  phase: number;
  /** Remaining waypoints the agent is walking toward. */
  waypoints: Point[];
  /** The targetPosition that generated the current waypoints (for change detection). */
  pathTarget: Point | null;
  /** Desk indices of active children to visit during patrol. */
  patrolChildDesks: number[];
  /** Which child desk we're visiting next in the patrol cycle. */
  patrolIndex: number;
  /** Countdown timer when pausing at a child's desk. */
  patrolPauseTimer: number;
  /** Cooldown before starting the next patrol cycle. */
  patrolCooldown: number;
  /** Whether a patrol cycle is currently active. */
  isPatrolling: boolean;
  /** Waypoints for current patrol leg (separate from standard waypoints). */
  patrolWaypoints: Point[];
  /** Agent ID of the child whose desk we're currently paused at. */
  patrolCurrentChildId: string | null;
  /** Delegation escort sequence state */
  delegationState: 'none' | 'walking-to-door' | 'waiting-at-door' | 'escorting' | 'returning';
  delegationChildId: string | null;
  delegationTimer: number;
  /** Waiting-on-team pacing state */
  isPacingForTeam: boolean;
  paceTarget: Point | null;
  paceTimer: number;
  /** Tiny pixel crown floating above supervisor's head */
  crown: Graphics | null;
}

export class AgentSpriteManager {
  private readonly sprites = new Map<string, AgentVisual>();
  private gifTemplate: AnimatedGIF | null = null;
  private openclawTexture: Texture | null = null;

  constructor(private readonly container: Container) {}

  async loadSpritesheets(): Promise<void> {
    try {
      const gif = await Assets.load(claudeGifUrl) as AnimatedGIF;
      this.gifTemplate = gif;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[sprites] failed to load claude.gif:', (error as Error).message);
    }
    try {
      this.openclawTexture = await Assets.load(openclawSvgUrl) as Texture;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[sprites] failed to load openclaw-mascot.svg:', (error as Error).message);
    }
  }

  addAgent(agent: Agent): void {
    if (this.sprites.has(agent.id)) return;

    let sprite: Sprite;
    let baseSize: number;
    if (isOpenClawAgent(agent) && this.openclawTexture) {
      sprite = new Sprite(this.openclawTexture);
      baseSize = OPENCLAW_SPRITE_SIZE;
      sprite.anchor.set(0.5, 0.75);
      sprite.width = baseSize;
      sprite.height = baseSize;
    } else if (this.gifTemplate) {
      sprite = this.gifTemplate.clone();
      baseSize = SPRITE_SIZE;
      sprite.anchor.set(0.5, 0.75);
      sprite.width = baseSize;
      sprite.height = baseSize;
      spritePlay(sprite);
    } else {
      return; // no textures available
    }

    // Shadow ellipse for contrast against any background
    const shadow = new Graphics();
    shadow.ellipse(0, 0, 8, 3).fill({ color: 0x000000, alpha: 0.35 });
    shadow.x = agent.position.x;
    shadow.y = agent.position.y + 4;
    this.container.addChild(shadow);

    sprite.x = agent.position.x;
    sprite.y = agent.position.y;
    this.container.addChild(sprite);
    this.sprites.set(agent.id, {
      sprite, shadow, baseSize, phase: 0, waypoints: [], pathTarget: null,
      patrolChildDesks: [], patrolIndex: 0, patrolPauseTimer: 0,
      patrolCooldown: 0, isPatrolling: false, patrolWaypoints: [],
      patrolCurrentChildId: null,
      delegationState: 'none', delegationChildId: null, delegationTimer: 0,
      isPacingForTeam: false, paceTarget: null, paceTimer: 0,
      crown: null,
    });
  }

  removeAgent(id: string): void {
    const visual = this.sprites.get(id);
    if (!visual) {
      return;
    }
    if (visual.crown) visual.crown.destroy();
    visual.shadow.destroy();
    visual.sprite.destroy();
    spritePositions.delete(id);
    supervisorCheckIns.delete(id);
    this.sprites.delete(id);
  }

  update(deltaSeconds: number, agents: Map<string, Agent>): void {
    const { focusedAgentId: focusedId, focusedAgentIds } = useOfficeStore.getState();

    for (const [id, agent] of agents.entries()) {
      const visual = this.sprites.get(id);
      if (!visual) {
        continue;
      }
      const sprite = visual.sprite;

      // --- Delegation escort sequence (highest priority) ---
      const delegationHandled = this.updateDelegation(deltaSeconds, agent, visual, agents);
      if (delegationHandled) {
        // Keep shadow tracking + scale/focus (below), but skip normal movement
        visual.shadow.x = sprite.x;
        visual.shadow.y = sprite.y + 4;

        if (id === focusedId || focusedAgentIds.has(id)) {
          const pulseSize = visual.baseSize + Math.sin(visual.phase * 4) * 3;
          sprite.width = pulseSize;
          sprite.height = pulseSize;
        } else {
          sprite.width = visual.baseSize;
          sprite.height = visual.baseSize;
        }
        this.updateCrown(agent, visual, agents);
        spritePositions.set(id, { x: sprite.x, y: sprite.y });
        continue;
      }

      // --- Supervisor patrol (higher priority than pacing, lower than delegation) ---
      const patrolHandled = this.updatePatrol(deltaSeconds, agent, visual, agents);
      if (patrolHandled) {
        visual.shadow.x = sprite.x;
        visual.shadow.y = sprite.y + 4;

        // Supervisor gold glow when paused at a desk (not walking)
        const patrolWalking = visual.patrolWaypoints.length > 0 && visual.patrolPauseTimer <= 0;
        if (!patrolWalking && agent.state !== 'error' && !agent.waitingForHuman) {
          const t = (Math.sin(visual.phase * 1.5) + 1) / 2;
          const g = Math.round(0xd5 + (0xff - 0xd5) * t);
          const b = Math.round(0x4f + (0xff - 0x4f) * t);
          sprite.tint = (0xff << 16) | (g << 8) | b;
        }
        if (id === focusedId || focusedAgentIds.has(id)) {
          const pulseSize = visual.baseSize + Math.sin(visual.phase * 4) * 3;
          sprite.width = pulseSize;
          sprite.height = pulseSize;
        } else {
          sprite.width = visual.baseSize;
          sprite.height = visual.baseSize;
        }
        this.updateCrown(agent, visual, agents);
        spritePositions.set(id, { x: sprite.x, y: sprite.y });
        continue;
      }

      // --- Waiting-on-team pacing (lower priority than patrol, higher than idle) ---
      const pacingHandled = this.updatePacing(deltaSeconds, agent, visual, agents);
      if (pacingHandled) {
        visual.shadow.x = sprite.x;
        visual.shadow.y = sprite.y + 4;

        if (id === focusedId || focusedAgentIds.has(id)) {
          const pulseSize = visual.baseSize + Math.sin(visual.phase * 4) * 3;
          sprite.width = pulseSize;
          sprite.height = pulseSize;
        } else {
          sprite.width = visual.baseSize;
          sprite.height = visual.baseSize;
        }
        this.updateCrown(agent, visual, agents);
        spritePositions.set(id, { x: sprite.x, y: sprite.y });
        continue;
      }

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
            if (!spritePlaying(sprite)) {
              spritePlay(sprite);
            }
          }
        }
      }

      // Keep shadow tracking the sprite
      visual.shadow.x = sprite.x;
      visual.shadow.y = sprite.y + 4;

      // Focus highlight pulse + waitingForHuman treatment
      if (agent.waitingForHuman && visual.waypoints.length === 0 && agent.targetPosition) {
        // Pulsing yellow tint for waiting-for-human
        const tintPulse = Math.sin(visual.phase * 3);
        sprite.tint = tintPulse > 0 ? 0xffeb3b : 0xffffff;
        // Bob relative to target position (non-cumulative)
        sprite.y = agent.targetPosition.y + Math.sin(visual.phase * 1.5) * 0.5;
      }

      // Supervisor gold glow when idle at station (not walking, not error, not waiting-for-human)
      const hasActiveChildren = agent.childIds.some((cid) => agents.has(cid));
      if (
        hasActiveChildren &&
        visual.waypoints.length === 0 &&
        !agent.waitingForHuman &&
        agent.state !== 'error'
      ) {
        const t = (Math.sin(visual.phase * 1.5) + 1) / 2;
        const g = Math.round(0xd5 + (0xff - 0xd5) * t);
        const b = Math.round(0x4f + (0xff - 0x4f) * t);
        sprite.tint = (0xff << 16) | (g << 8) | b;
      }

      if (id === focusedId || focusedAgentIds.has(id)) {
        const pulseSize = visual.baseSize + Math.sin(visual.phase * 4) * 3;
        sprite.width = pulseSize;
        sprite.height = pulseSize;
      } else {
        sprite.width = visual.baseSize;
        sprite.height = visual.baseSize;
      }

      // --- Crown for supervisor with active children ---
      this.updateCrown(agent, visual, agents, hasActiveChildren);

      // Export sprite position for HTML bubble overlay
      spritePositions.set(id, { x: sprite.x, y: sprite.y });
    }
  }

  /**
   * Delegation escort sequence. Returns true if the delegation system is handling movement.
   */
  private updateDelegation(
    deltaSeconds: number,
    agent: Agent,
    visual: AgentVisual,
    agents: Map<string, Agent>,
  ): boolean {
    const sprite = visual.sprite;

    // Cancel delegation if agent transitions to a non-delegating active state
    if (visual.delegationState !== 'none' && agent.state !== 'delegating'
      && !PASSIVE_STATES.has(agent.state)) {
      visual.delegationState = 'none';
      visual.delegationChildId = null;
      visual.delegationTimer = 0;
      return false;
    }

    // Trigger delegation: agent just entered 'delegating' state with children
    if (visual.delegationState === 'none' && agent.state === 'delegating' && agent.childIds.length > 0) {
      visual.delegationState = 'walking-to-door';
      visual.delegationChildId = null;
      const doorWorld = tileToWorld(STATIONS.door);
      const path = findPath({ x: sprite.x, y: sprite.y }, doorWorld);
      visual.waypoints = path.length > 0 ? path : [doorWorld];
      visual.pathTarget = null; // prevent normal path logic from interfering
    }

    if (visual.delegationState === 'none') {
      return false;
    }

    visual.phase += deltaSeconds * 8;

    // State: walking to door
    if (visual.delegationState === 'walking-to-door') {
      if (visual.waypoints.length === 0) {
        // Arrived at door
        visual.delegationState = 'waiting-at-door';
        visual.delegationTimer = DOOR_WAIT_DURATION;
        spriteStop(sprite);
      } else {
        this.walkAlongWaypoints(sprite, visual, deltaSeconds, 35);
      }
      return true;
    }

    // State: waiting at door for child to appear
    if (visual.delegationState === 'waiting-at-door') {
      visual.delegationTimer -= deltaSeconds;
      // Look for a newly-appeared child agent
      const newChild = this.findNewChildAtDoor(agent, agents);
      if (newChild) {
        visual.delegationState = 'escorting';
        visual.delegationChildId = newChild.id;
        visual.delegationTimer = 0; // reset for handoff phase
        // Path to child's desk
        if (newChild.deskIndex !== null) {
          const deskTile = STATIONS.desks[newChild.deskIndex];
          const deskWorld = tileToWorld(deskTile);
          const path = findPath({ x: sprite.x, y: sprite.y }, deskWorld);
          visual.waypoints = path.length > 0 ? path : [deskWorld];
        } else {
          // No desk assigned — just go back
          visual.delegationState = 'returning';
          this.generateReturnPath(agent, visual, sprite);
        }
      } else if (visual.delegationTimer <= 0) {
        // Timed out waiting — check if any child already exists
        const existingChild = agent.childIds.find((cid) => agents.has(cid));
        if (existingChild) {
          const child = agents.get(existingChild)!;
          visual.delegationState = 'escorting';
          visual.delegationChildId = existingChild;
          visual.delegationTimer = 0; // reset for handoff phase
          if (child.deskIndex !== null) {
            const deskTile = STATIONS.desks[child.deskIndex];
            const deskWorld = tileToWorld(deskTile);
            const path = findPath({ x: sprite.x, y: sprite.y }, deskWorld);
            visual.waypoints = path.length > 0 ? path : [deskWorld];
          } else {
            visual.delegationState = 'returning';
            this.generateReturnPath(agent, visual, sprite);
          }
        } else {
          // No child appeared — return to desk
          visual.delegationState = 'returning';
          this.generateReturnPath(agent, visual, sprite);
        }
      }
      spriteStop(sprite);
      return true;
    }

    // State: escorting child to their desk
    if (visual.delegationState === 'escorting') {
      if (visual.waypoints.length === 0) {
        // Arrived at child's desk — start/continue handoff pause
        if (visual.delegationTimer <= 0) {
          // Just arrived — initialize handoff timer
          visual.delegationTimer = ESCORT_HANDOFF_DURATION;
        }
        visual.delegationTimer -= deltaSeconds;
        if (visual.delegationTimer <= 0) {
          // Handoff complete — return to own desk
          visual.delegationState = 'returning';
          visual.delegationChildId = null;
          visual.delegationTimer = 0;
          this.generateReturnPath(agent, visual, sprite);
        } else {
          spriteStop(sprite);
        }
      } else {
        this.walkAlongWaypoints(sprite, visual, deltaSeconds, 35);
      }
      return true;
    }

    // State: returning to own desk
    if (visual.delegationState === 'returning') {
      if (visual.waypoints.length === 0) {
        // Back at desk — end delegation sequence
        visual.delegationState = 'none';
        visual.delegationChildId = null;
        visual.delegationTimer = 0;
        return false;
      }
      this.walkAlongWaypoints(sprite, visual, deltaSeconds, 35);
      return true;
    }

    return false;
  }

  /**
   * Find a child that recently appeared near the door.
   */
  private findNewChildAtDoor(agent: Agent, agents: Map<string, Agent>): Agent | null {
    const doorWorld = tileToWorld(STATIONS.door);
    for (const childId of agent.childIds) {
      const child = agents.get(childId);
      if (!child) continue;
      // Child is near door (just entered) — within 2 tiles
      const dist = Math.hypot(child.position.x - doorWorld.x, child.position.y - doorWorld.y);
      if (dist < 48) {
        return child;
      }
    }
    return null;
  }

  /**
   * Generate waypoints to return the agent to their own desk.
   */
  private generateReturnPath(agent: Agent, visual: AgentVisual, sprite: Sprite): void {
    // Delegating agents return to the supervisor desk, not their own
    const targetDeskIndex = agent.state === 'delegating'
      ? STATIONS.desks.length - 1
      : agent.deskIndex;
    if (targetDeskIndex !== null) {
      const deskTile = STATIONS.desks[targetDeskIndex];
      const deskWorld = tileToWorld(deskTile);
      const path = findPath({ x: sprite.x, y: sprite.y }, deskWorld);
      visual.waypoints = path.length > 0 ? path : [deskWorld];
    } else {
      visual.waypoints = [];
    }
  }

  /**
   * Walk the sprite along its waypoint array at the given speed.
   */
  private walkAlongWaypoints(
    sprite: Sprite,
    visual: AgentVisual,
    deltaSeconds: number,
    speed: number,
  ): void {
    if (visual.waypoints.length === 0) return;
    const wp = visual.waypoints[0];
    const dx = wp.x - sprite.x;
    const dy = wp.y - sprite.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 1) {
      sprite.x = wp.x;
      sprite.y = wp.y;
      visual.waypoints.shift();
    } else {
      const nx = dx / dist;
      const ny = dy / dist;
      sprite.x += nx * speed * deltaSeconds;
      sprite.y += ny * speed * deltaSeconds;
      if (!spritePlaying(sprite)) spritePlay(sprite);
    }
  }

  /**
   * Waiting-on-team pacing. Returns true if pacing is handling movement.
   * Lower priority than patrol — skipped if isPatrolling is true.
   */
  private updatePacing(
    deltaSeconds: number,
    agent: Agent,
    visual: AgentVisual,
    agents: Map<string, Agent>,
  ): boolean {
    const isPassive = PASSIVE_STATES.has(agent.state);
    const hasActiveChildren = agent.childIds.length > 0
      && agent.childIds.some((cid) => agents.has(cid));

    // Only pace when: passive state, has active children, not patrolling, not delegating
    if (!isPassive || !hasActiveChildren || visual.isPatrolling || visual.delegationState !== 'none') {
      // Reset pacing if it was active
      if (visual.isPacingForTeam) {
        visual.isPacingForTeam = false;
        visual.paceTarget = null;
        visual.paceTimer = 0;
      }
      return false;
    }

    const sprite = visual.sprite;
    visual.phase += deltaSeconds * 8;

    // Initialize pacing if not active
    if (!visual.isPacingForTeam) {
      visual.isPacingForTeam = true;
      visual.paceTimer = PACE_PAUSE_MIN + Math.random() * (PACE_PAUSE_MAX - PACE_PAUSE_MIN);
      visual.paceTarget = null;
      visual.waypoints = [];
      spriteStop(sprite);
      return true;
    }

    // Currently walking to a pace target
    if (visual.paceTarget && visual.waypoints.length > 0) {
      this.walkAlongWaypoints(sprite, visual, deltaSeconds, PACE_SPEED);
      if (visual.waypoints.length === 0) {
        // Arrived at pace target — start pause
        visual.paceTarget = null;
        visual.paceTimer = PACE_PAUSE_MIN + Math.random() * (PACE_PAUSE_MAX - PACE_PAUSE_MIN);
        spriteStop(sprite);
      }
      return true;
    }

    // Pausing at current position
    visual.paceTimer -= deltaSeconds;
    if (visual.paceTimer <= 0) {
      // Pick a new random mid-office target
      const tx = PACE_AREA.minX + Math.floor(Math.random() * (PACE_AREA.maxX - PACE_AREA.minX + 1));
      const ty = PACE_AREA.minY + Math.floor(Math.random() * (PACE_AREA.maxY - PACE_AREA.minY + 1));
      const target = tileToWorld({ x: tx, y: ty });
      const path = findPath({ x: sprite.x, y: sprite.y }, target);
      if (path.length > 0) {
        visual.paceTarget = target;
        visual.waypoints = path;
      } else {
        // Couldn't find path — try again next frame
        visual.paceTimer = 0.5;
      }
    } else {
      spriteStop(sprite);
    }
    return true;
  }

  /**
   * Supervisor patrol cycle. Returns true if patrol is handling movement.
   */
  private updatePatrol(
    deltaSeconds: number,
    agent: Agent,
    visual: AgentVisual,
    agents: Map<string, Agent>,
  ): boolean {
    const activeChildIds = agent.childIds.filter((cid) => agents.has(cid));
    const isSupervisor = activeChildIds.length > 0;
    const isPassive = PASSIVE_STATES.has(agent.state);

    // Only patrol when: supervisor with active children, in a passive state, not delegating
    if (!isSupervisor || !isPassive || visual.delegationState !== 'none') {
      if (visual.isPatrolling) {
        visual.isPatrolling = false;
        visual.patrolWaypoints = [];
        visual.patrolPauseTimer = 0;
        visual.patrolCooldown = 0;
        supervisorCheckIns.delete(agent.id);
        visual.patrolCurrentChildId = null;
      }
      return false;
    }

    const sprite = visual.sprite;

    // Tick cooldown
    if (visual.patrolCooldown > 0) {
      visual.patrolCooldown -= deltaSeconds;
    }

    // Start a new patrol cycle if not active and cooldown expired
    if (!visual.isPatrolling && visual.patrolCooldown <= 0) {
      const childDesks = activeChildIds
        .map((cid) => agents.get(cid)?.deskIndex)
        .filter((d): d is number => d != null);
      if (childDesks.length > 0) {
        visual.patrolChildDesks = childDesks;
        visual.patrolIndex = 0;
        visual.isPatrolling = true;
        visual.patrolPauseTimer = 0;
        visual.patrolWaypoints = [];
        visual.patrolCurrentChildId = null;
      }
    }

    if (!visual.isPatrolling) {
      return false;
    }

    visual.phase += deltaSeconds * 8;

    // Pausing at a child's desk
    if (visual.patrolPauseTimer > 0) {
      visual.patrolPauseTimer -= deltaSeconds;
      this.applyIdlePose(agent, visual, 0); // 0 delta to avoid double phase increment

      if (visual.patrolPauseTimer <= 0) {
        supervisorCheckIns.delete(agent.id);
        visual.patrolCurrentChildId = null;
        visual.patrolIndex += 1;
        visual.patrolWaypoints = [];
      }
      return true;
    }

    // Walking to next child's desk
    if (visual.patrolIndex < visual.patrolChildDesks.length) {
      const targetDeskIdx = visual.patrolChildDesks[visual.patrolIndex];
      const deskTile = STATIONS.desks[targetDeskIdx];
      const targetWorld = tileToWorld(deskTile);

      if (visual.patrolWaypoints.length === 0) {
        const path = findPath({ x: sprite.x, y: sprite.y }, targetWorld);
        visual.patrolWaypoints = path.length > 0 ? path : [targetWorld];
      }

      const arrived = this.walkPatrolWaypoints(sprite, visual, deltaSeconds);
      if (arrived) {
        // Start pause and check-in
        visual.patrolPauseTimer = PATROL_PAUSE_DURATION;
        const childId = activeChildIds.find(
          (cid) => agents.get(cid)?.deskIndex === targetDeskIdx,
        );
        visual.patrolCurrentChildId = childId ?? null;
        if (childId) {
          const msg = CHECKIN_MESSAGES[Math.floor(Math.random() * CHECKIN_MESSAGES.length)];
          supervisorCheckIns.set(agent.id, { childId, message: msg });
        }
        this.applyIdlePose(agent, visual, 0);
      }
      return true;
    }

    // All children visited — walk back to supervisor desk (if delegating) or own desk
    const returnDeskIndex = agent.state === 'delegating'
      ? STATIONS.desks.length - 1
      : agent.deskIndex;
    if (returnDeskIndex != null) {
      const ownDeskTile = STATIONS.desks[returnDeskIndex];
      const ownWorld = tileToWorld(ownDeskTile);

      if (visual.patrolWaypoints.length === 0) {
        const path = findPath({ x: sprite.x, y: sprite.y }, ownWorld);
        visual.patrolWaypoints = path.length > 0 ? path : [ownWorld];
      }

      const arrived = this.walkPatrolWaypoints(sprite, visual, deltaSeconds);
      if (arrived) {
        visual.isPatrolling = false;
        visual.patrolCooldown = PATROL_COOLDOWN_DURATION;
        this.applyIdlePose(agent, visual, 0);
      }
    } else {
      visual.isPatrolling = false;
      visual.patrolCooldown = PATROL_COOLDOWN_DURATION;
    }
    return true;
  }

  /**
   * Walk the sprite along patrolWaypoints. Returns true when all waypoints are consumed (arrived).
   */
  private walkPatrolWaypoints(
    sprite: Sprite,
    visual: AgentVisual,
    deltaSeconds: number,
  ): boolean {
    if (visual.patrolWaypoints.length === 0) return true;

    const wp = visual.patrolWaypoints[0];
    const dx = wp.x - sprite.x;
    const dy = wp.y - sprite.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 1) {
      sprite.x = wp.x;
      sprite.y = wp.y;
      visual.patrolWaypoints.shift();
      return visual.patrolWaypoints.length === 0;
    }

    const speed = 35;
    const nx = dx / dist;
    const ny = dy / dist;
    sprite.x += nx * speed * deltaSeconds;
    sprite.y += ny * speed * deltaSeconds;
    if (!spritePlaying(sprite)) spritePlay(sprite);
    return false;
  }

  /**
   * Draw a tiny pixel-art crown (~10x6px) centered at its own origin.
   */
  private drawCrown(): Graphics {
    const g = new Graphics();
    // Gold base band (10px wide, 2px tall)
    g.rect(-5, 2, 10, 2).fill(0xffd54f);
    // Three pointed peaks
    g.rect(-5, 0, 2, 2).fill(0xffd54f); // left peak
    g.rect(-1, 0, 2, 2).fill(0xffd54f); // center peak
    g.rect(3, 0, 2, 2).fill(0xffd54f);  // right peak
    g.rect(-5, -1, 2, 1).fill(0xffd54f); // left tip
    g.rect(-1, -1, 2, 1).fill(0xffd54f); // center tip
    g.rect(3, -1, 2, 1).fill(0xffd54f);  // right tip
    // Tiny gem dots on the base
    g.rect(-3, 2, 2, 2).fill(0xff4444); // red gem
    g.rect(1, 2, 2, 2).fill(0x4488ff);  // blue gem
    return g;
  }

  /**
   * Show/hide/position the crown above the supervisor's head.
   */
  private updateCrown(agent: Agent, visual: AgentVisual, _agents: Map<string, Agent>, hasActiveChildren?: boolean): void {
    if (hasActiveChildren === undefined) {
      hasActiveChildren = agent.childIds.some((cid) => _agents.has(cid));
    }
    const sprite = visual.sprite;

    if (hasActiveChildren) {
      // Show crown
      if (!visual.crown) {
        visual.crown = this.drawCrown();
        this.container.addChild(visual.crown);
      }
      // Position above head with gentle bob
      visual.crown.x = sprite.x;
      visual.crown.y = sprite.y - sprite.height * 0.75 - 8 + Math.sin(visual.phase * 2) * 1;
    } else {
      // Hide crown
      if (visual.crown) {
        visual.crown.destroy();
        visual.crown = null;
      }
    }
  }

  private applyIdlePose(agent: Agent, visual: AgentVisual, deltaSeconds: number): void {
    const sprite = visual.sprite;
    visual.phase += deltaSeconds * 8;

    // Use targetPosition as fixed base to prevent cumulative drift
    const baseX = agent.targetPosition?.x ?? sprite.x;
    const baseY = agent.targetPosition?.y ?? sprite.y;

    // Reset tint in case it was set by a previous error state
    sprite.tint = 0xffffff;

    if (agent.state === 'thinking') {
      spriteStop(sprite);
      sprite.x = baseX + Math.sin(visual.phase) * 0.1;
      sprite.y = baseY;
      return;
    }

    if (agent.state === 'terminal') {
      spriteStop(sprite);
      sprite.x = baseX;
      sprite.y = baseY + Math.sin(visual.phase * 2) * 0.3;
      return;
    }

    if (agent.state === 'coding' || agent.state === 'reading') {
      spriteStop(sprite);
      sprite.x = baseX;
      sprite.y = baseY + Math.sin(visual.phase) * 0.3;
      return;
    }

    if (agent.state === 'searching') {
      spriteStop(sprite);
      sprite.x = baseX + Math.sin(visual.phase * 1.5) * 0.15;
      sprite.y = baseY;
      return;
    }

    if (agent.state === 'cooling') {
      spriteStop(sprite);
      sprite.x = baseX;
      sprite.y = baseY + Math.sin(visual.phase * 0.8) * 0.4;
      return;
    }

    if (agent.state === 'error') {
      spriteStop(sprite);
      sprite.x = baseX;
      sprite.y = baseY;
      sprite.tint = Math.sin(visual.phase * 3) > 0 ? 0xff4444 : 0xffffff;
      return;
    }

    if (agent.state === 'needsApproval') {
      spriteStop(sprite);
      // Pulsing orange tint
      sprite.tint = Math.sin(visual.phase * 2) > 0 ? 0xff9800 : 0xffffff;
      // Vertical bob
      sprite.x = baseX;
      sprite.y = baseY + Math.sin(visual.phase * 1.5) * 0.5;
      return;
    }

    if (agent.state === 'compacting') {
      spriteStop(sprite);
      // Subtle purple tint blend
      const t = (Math.sin(visual.phase * 1.2) + 1) / 2;
      const r = Math.round(0xff - (0xff - 0xab) * t * 0.4);
      const g = Math.round(0xff - (0xff - 0x47) * t * 0.4);
      const b = Math.round(0xff - (0xff - 0xbc) * t * 0.4);
      sprite.tint = (r << 16) | (g << 8) | b;
      // Slow bob
      sprite.x = baseX;
      sprite.y = baseY + Math.sin(visual.phase * 0.8) * 0.3;
      return;
    }

    // Default idle (delegating, waiting, etc.)
    spriteStop(sprite);
    sprite.x = baseX;
    sprite.y = baseY;
  }

}
