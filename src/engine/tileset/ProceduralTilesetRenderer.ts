import { Container, Graphics } from 'pixi.js';
import type { TilesetRenderer } from './TilesetRenderer.js';
import type { MapConfig } from './MapConfig.js';

/**
 * Procedural fallback renderer that draws the office with colored rectangles.
 * Used when the LimeZu spritesheet is not available.
 */
export class ProceduralTilesetRenderer implements TilesetRenderer {
  private graphics: Graphics | null = null;

  async init(): Promise<void> {
    // No assets to load for procedural rendering
  }

  renderMap(container: Container, mapConfig: MapConfig): void {
    const g = new Graphics();
    const ts = mapConfig.tileSize;
    const w = mapConfig.gridWidth * ts;
    const h = mapConfig.gridHeight * ts;

    // Floor
    g.rect(0, 0, w, h).fill(0x2e3138);

    // Walls (border)
    g.rect(0, 0, w, ts).fill(0x1f2127);
    g.rect(0, 0, ts, h).fill(0x1f2127);
    g.rect(w - ts, 0, ts, h).fill(0x1f2127);
    g.rect(0, h - ts, w, ts).fill(0x1f2127);

    const { stations } = mapConfig;

    // Desks
    for (const desk of stations.desks) {
      const x = desk.x * ts;
      const y = desk.y * ts;
      g.rect(x, y, ts * 2, ts).fill(0x6f4e37);
      g.rect(x + 3, y + 3, ts - 6, ts - 6).fill(0x89a8c7);
    }

    // Whiteboard
    g.rect(stations.whiteboard.x * ts, stations.whiteboard.y * ts, ts * 3, ts).fill(0x8ea4b8);

    // Terminal
    g.rect(stations.terminal.x * ts, stations.terminal.y * ts, ts * 2, ts).fill(0x111722);
    g.rect(
      stations.terminal.x * ts + 1,
      stations.terminal.y * ts + 1,
      ts * 2 - 2,
      ts - 2,
    ).stroke({ color: 0x2ee65e, width: 1 });

    // Library / bookshelf
    g.rect(stations.library.x * ts, stations.library.y * ts, ts * 3, ts).fill(0x5c3a1e);
    g.rect(stations.library.x * ts + 2, stations.library.y * ts + 3, ts - 4, ts - 6).fill(0xd4a574);
    g.rect(stations.library.x * ts + ts + 2, stations.library.y * ts + 3, ts - 4, ts - 6).fill(0xc49a6c);
    g.rect(stations.library.x * ts + ts * 2 + 2, stations.library.y * ts + 3, ts - 4, ts - 6).fill(0xb8906a);

    // Coffee machine
    g.rect(stations.coffee.x * ts, stations.coffee.y * ts, ts * 2, ts).fill(0x3d2b1f);
    g.rect(stations.coffee.x * ts + 3, stations.coffee.y * ts + 2, ts - 4, ts - 4).fill(0x8b4513);

    // Door
    g.rect(stations.door.x * ts, stations.door.y * ts, ts, ts).stroke({ color: 0xe3d7c0, width: 1 });

    container.addChild(g);
    this.graphics = g;
  }

  destroy(): void {
    this.graphics?.destroy();
    this.graphics = null;
  }
}
