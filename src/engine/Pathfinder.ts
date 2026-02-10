import PF from 'pathfinding';
import type { Point } from '../types/agent.js';
import { STATIONS, TILE_SIZE } from '../types/agent.js';

const GRID_W = 20;
const GRID_H = 15;

function buildGrid(): PF.Grid {
  const grid = new PF.Grid(GRID_W, GRID_H);

  // Border walls
  for (let x = 0; x < GRID_W; x++) {
    grid.setWalkableAt(x, 0, false);
    grid.setWalkableAt(x, GRID_H - 1, false);
  }
  for (let y = 0; y < GRID_H; y++) {
    grid.setWalkableAt(0, y, false);
    grid.setWalkableAt(GRID_W - 1, y, false);
  }

  // Re-open the door tile so agents can enter/exit
  grid.setWalkableAt(STATIONS.door.x, STATIONS.door.y, true);

  // Desks — each desk is 2 tiles wide
  for (const desk of STATIONS.desks) {
    grid.setWalkableAt(desk.x, desk.y, false);
    grid.setWalkableAt(desk.x + 1, desk.y, false);
  }

  // Whiteboard — 3 tiles wide
  grid.setWalkableAt(STATIONS.whiteboard.x, STATIONS.whiteboard.y, false);
  grid.setWalkableAt(STATIONS.whiteboard.x + 1, STATIONS.whiteboard.y, false);
  grid.setWalkableAt(STATIONS.whiteboard.x + 2, STATIONS.whiteboard.y, false);

  // Terminal — 2 tiles wide
  grid.setWalkableAt(STATIONS.terminal.x, STATIONS.terminal.y, false);
  grid.setWalkableAt(STATIONS.terminal.x + 1, STATIONS.terminal.y, false);

  // Library — 3 tiles wide
  grid.setWalkableAt(STATIONS.library.x, STATIONS.library.y, false);
  grid.setWalkableAt(STATIONS.library.x + 1, STATIONS.library.y, false);
  grid.setWalkableAt(STATIONS.library.x + 2, STATIONS.library.y, false);

  // Coffee machine — 2 tiles wide
  grid.setWalkableAt(STATIONS.coffee.x, STATIONS.coffee.y, false);
  grid.setWalkableAt(STATIONS.coffee.x + 1, STATIONS.coffee.y, false);

  return grid;
}

const baseGrid = buildGrid();
const finder = new PF.AStarFinder({
  diagonalMovement: PF.DiagonalMovement.Never,
});

/**
 * Convert a world-coordinate position to a tile coordinate, clamped to the walkable area.
 */
function worldToTile(p: Point): Point {
  return {
    x: Math.max(0, Math.min(GRID_W - 1, Math.floor(p.x / TILE_SIZE))),
    y: Math.max(0, Math.min(GRID_H - 1, Math.floor(p.y / TILE_SIZE))),
  };
}

/**
 * Convert a tile coordinate to a world-coordinate (center of tile).
 */
function tileToWorld(t: Point): Point {
  return {
    x: t.x * TILE_SIZE + TILE_SIZE / 2,
    y: t.y * TILE_SIZE + TILE_SIZE / 2,
  };
}

/**
 * Find a path between two world-coordinate points.
 * Returns an array of world-coordinate waypoints (centers of tiles).
 * Returns an empty array if no path is found.
 */
export function findPath(from: Point, to: Point): Point[] {
  const start = worldToTile(from);
  const end = worldToTile(to);

  // Clone the grid — the pathfinding library mutates it during search
  const grid = baseGrid.clone();

  // Temporarily mark start/end as walkable in case they sit on furniture
  // (agent may be standing at a station tile)
  grid.setWalkableAt(start.x, start.y, true);
  grid.setWalkableAt(end.x, end.y, true);

  const rawPath = finder.findPath(start.x, start.y, end.x, end.y, grid);

  if (rawPath.length === 0) {
    return [];
  }

  // Convert tile coordinates to world coordinates, skip the first (current position)
  return rawPath.slice(1).map(([tx, ty]) => tileToWorld({ x: tx, y: ty }));
}
