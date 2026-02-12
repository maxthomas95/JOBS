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

export const STATIONS = {
  door: { x: 17, y: 13 },
  whiteboard: { x: 2, y: 2 },
  terminal: { x: 2, y: 12 },
  library: { x: 16, y: 2 },
  coffee: { x: 9, y: 12 },
  desks: [
    { x: 2, y: 6 },
    { x: 5, y: 6 },
    { x: 8, y: 6 },
    { x: 11, y: 6 },
    { x: 14, y: 6 },
    { x: 2, y: 9 },
    { x: 5, y: 9 },
    { x: 8, y: 9 },
    { x: 11, y: 9 },
    { x: 14, y: 9 },
  ],
} as const;

export function tileToWorld(point: Point): Point {
  return {
    x: point.x * TILE_SIZE + TILE_SIZE / 2,
    y: point.y * TILE_SIZE + TILE_SIZE / 2,
  };
}
