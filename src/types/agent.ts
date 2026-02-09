export type AgentState =
  | 'entering'
  | 'coding'
  | 'reading'
  | 'thinking'
  | 'terminal'
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
}

export const TILE_SIZE = 16;

export const STATIONS = {
  door: { x: 17, y: 13 },
  whiteboard: { x: 2, y: 2 },
  terminal: { x: 2, y: 12 },
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
