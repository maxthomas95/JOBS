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

/** Station positions — mutable so they can be updated from map config at startup. */
export const STATIONS: {
  door: Point;
  whiteboard: Point;
  terminal: Point;
  library: Point;
  coffee: Point;
  desks: Point[];
} = {
  door: { x: 18, y: 13 },
  whiteboard: { x: 9, y: 2 },
  terminal: { x: 13, y: 12 },
  library: { x: 2, y: 3 },
  coffee: { x: 16, y: 12 },
  desks: [
    { x: 4, y: 6 },
    { x: 8, y: 6 },
    { x: 12, y: 6 },
    { x: 4, y: 9 },
    { x: 8, y: 9 },
    { x: 12, y: 9 },
  ],
};

/**
 * Update STATIONS from a map config's station positions.
 * Called at startup from PixelOffice before any rendering.
 */
export function setStationsFromConfig(stations: {
  door: Point;
  whiteboard: Point;
  terminal: Point;
  library: Point;
  coffee: Point;
  desks: Point[];
}): void {
  STATIONS.door = stations.door;
  STATIONS.whiteboard = stations.whiteboard;
  STATIONS.terminal = stations.terminal;
  STATIONS.library = stations.library;
  STATIONS.coffee = stations.coffee;
  STATIONS.desks = [...stations.desks];
}

export function tileToWorld(point: Point): Point {
  return {
    x: point.x * TILE_SIZE + TILE_SIZE / 2,
    y: point.y * TILE_SIZE + TILE_SIZE / 2,
  };
}
