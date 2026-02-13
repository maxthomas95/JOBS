import { Container } from 'pixi.js';
import type { MapConfig } from './MapConfig.js';

/**
 * Abstract interface for rendering a tilemap.
 * Implementations: ImageTilesetRenderer (LimeZu spritesheet) and ProceduralTilesetRenderer (fallback).
 */
export interface TilesetRenderer {
  /** Load assets and prepare for rendering. */
  init(): Promise<void>;
  /** Render the full map into the given container. */
  renderMap(container: Container, mapConfig: MapConfig): void;
  /** Clean up resources. */
  destroy(): void;
}
