import type { Point } from '../../types/agent.js';

/** A tile reference: either a tile ID string or null (empty). */
export type TileRef = string | null;

/** Station positions derived from the map config. */
export interface StationConfig {
  door: Point;
  whiteboard: Point;
  terminal: Point;
  library: Point;
  coffee: Point;
  desks: Point[];
}

/** Tileset definition: maps tile IDs to spritesheet coordinates. */
export interface TilesetDef {
  /** Path to the spritesheet image (relative to assets). */
  image: string;
  /** Tile size in pixels. */
  tileSize: number;
  /** Number of columns in the spritesheet. */
  columns: number;
  /** Map of tile ID -> { col, row } in the spritesheet. */
  tiles: Record<string, { col: number; row: number }>;
}

/** Full map configuration. */
export interface MapConfig {
  name: string;
  gridWidth: number;
  gridHeight: number;
  tileSize: number;
  /** Tileset definitions keyed by ID (e.g. "room", "office"). */
  tilesets: Record<string, TilesetDef>;
  /** Layers rendered bottom-to-top. Each layer is a flat array of TileRefs (gridWidth * gridHeight). */
  layers: {
    name: string;
    /** Each entry is "tilesetId:tileId" or null. */
    data: TileRef[];
  }[];
  /** Walkability grid: true = walkable. Flat array of gridWidth * gridHeight booleans. */
  walkability: boolean[];
  /** Station positions in tile coordinates. */
  stations: StationConfig;
}

/**
 * Load and parse a map config JSON file.
 */
export async function loadMapConfig(url: string): Promise<MapConfig> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load map config: ${response.statusText}`);
  }
  return response.json() as Promise<MapConfig>;
}
