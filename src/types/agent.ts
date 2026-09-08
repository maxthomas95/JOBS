import { OFFICE_LAYOUT, type OfficeStations } from './office-layout.js';

export type IntegrationMode = 'transcript' | 'hooks' | 'notify' | 'webhook';

export type AgentState =
  | 'entering'
  | 'coding'
  | 'reading'
  | 'thinking'
  | 'terminal'
  | 'searching'
  | 'cooling'
  | 'delegating'
  | 'error'
  | 'waiting'
  | 'needsApproval'
  | 'compacting'
  | 'idle'
  | 'leaving';

export interface Point {
  x: number;
  y: number;
}

export interface Agent {
  id: string;
  sessionId: string;
  characterIndex: number;
  state: AgentState;
  position: Point;
  targetPosition: Point | null;
  deskIndex: number | null;
  lastEventAt: number;
  /** Server-observed start of this active session segment. */
  startedAt?: number;
  integrationMode?: IntegrationMode;
  model?: string;
  /** Timestamp when the current state was entered */
  stateChangedAt: number;
  /** Short text describing current activity (e.g. "auth.ts", "running tests") */
  activityText: string | null;
  /** Memorable display name assigned by server (e.g. "Ada", "Grace") */
  name: string | null;
  /** Claude Code-assigned role/agent name (e.g. "m2-builder", "researcher") */
  roleName: string | null;
  /** Project/repo basename this agent is working on */
  project: string | null;
  /** Whether the agent is waiting for human input */
  waitingForHuman: boolean;
  /** Session ID of the parent agent that spawned this one via Task tool */
  parentId: string | null;
  /** Session IDs of child agents spawned by this agent */
  childIds: string[];
  /** Agent provider: 'claude' | 'codex' | 'webhook' */
  provider: string;
  /** Machine instance ID (null = local) */
  machineId: string | null;
  /** Machine display name */
  machineName: string | null;
  /** Webhook source type: 'ci', 'monitoring', 'deploy', 'codex' */
  sourceType: string | null;
  /** Webhook source display name: "GitHub Actions", "Codex CLI" */
  sourceName: string | null;
  /** External URL (e.g. link to CI run) */
  sourceUrl: string | null;
}

export const TILE_SIZE = 16;

/** Canonical geometry shared by the server, Tiled art, and fallback renderer. */
export const STATIONS: OfficeStations = OFFICE_LAYOUT.stations;

export function tileToWorld(point: Point): Point {
  return {
    x: point.x * TILE_SIZE + TILE_SIZE / 2,
    y: point.y * TILE_SIZE + TILE_SIZE / 2,
  };
}
