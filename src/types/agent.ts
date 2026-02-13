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
  door: { x: 17, y: 13 },
  whiteboard: { x: 6, y: 2 },
  terminal: { x: 1, y: 12 },
  library: { x: 16, y: 2 },
  coffee: { x: 9, y: 12 },
  desks: [
    { x: 3, y: 4 },
    { x: 6, y: 4 },
    { x: 9, y: 4 },
    { x: 12, y: 4 },
    { x: 15, y: 4 },
    { x: 3, y: 8 },
    { x: 6, y: 8 },
    { x: 9, y: 8 },
    { x: 12, y: 8 },
    { x: 15, y: 8 },
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
