import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';

// Tiled flip flags (high bits of GID)
const FLIPPED_HORIZONTALLY = 0x80000000;
const FLIPPED_VERTICALLY = 0x40000000;
const FLIPPED_DIAGONALLY = 0x20000000;
const GID_MASK = 0x1fffffff;

/** Tiled JSON tileset reference (embedded in .tmj). */
export interface TiledTilesetRef {
  firstgid: number;
  source: string;
}

/** Tiled JSON tile layer. */
export interface TiledLayer {
  data: number[];
  height: number;
  width: number;
  id: number;
  name: string;
  opacity: number;
  type: string;
  visible: boolean;
  x: number;
  y: number;
}

/** Tiled JSON map (subset of fields we use). */
export interface TiledMap {
  height: number;
  width: number;
  tileheight: number;
  tilewidth: number;
  layers: TiledLayer[];
  tilesets: TiledTilesetRef[];
}

/** Resolved tileset with loaded texture and computed dimensions. */
interface ResolvedTileset {
  firstgid: number;
  lastgid: number;
  columns: number;
  rows: number;
  texture: Texture;
}

/**
 * Renders a Tiled JSON map (.tmj) directly using PixiJS.
 * Handles multiple tilesets, unlimited layers, and tile flip flags.
 */
export class TiledMapRenderer {
  private resolved: ResolvedTileset[] = [];
  private tileTextureCache = new Map<number, Texture>();
  private sprites: Sprite[] = [];

  constructor(
    private readonly tiledMap: TiledMap,
    private readonly assetUrls: { firstgid: number; url: string }[],
  ) {}

  async init(): Promise<void> {
    const ts = this.tiledMap.tileheight;

    for (const { firstgid, url } of this.assetUrls) {
      const texture = await Assets.load<Texture>(url);
      const source = texture.source;
      const columns = Math.floor(source.width / ts);
      const rows = Math.floor(source.height / ts);
      const tilecount = columns * rows;

      this.resolved.push({
        firstgid,
        lastgid: firstgid + tilecount - 1,
        columns,
        rows,
        texture,
      });
    }

    // Sort by firstgid descending so lookup finds the right tileset first
    this.resolved.sort((a, b) => b.firstgid - a.firstgid);
  }

  renderMap(container: Container): void {
    const { width: gridW, tileheight: ts, tilewidth: tw } = this.tiledMap;

    for (const layer of this.tiledMap.layers) {
      if (layer.type !== 'tilelayer') continue;
      if (!layer.visible) continue;

      const layerContainer = new Container();
      layerContainer.label = layer.name;
      layerContainer.alpha = layer.opacity;

      for (let i = 0; i < layer.data.length; i++) {
        const rawGid = layer.data[i];
        if (rawGid === 0) continue; // empty

        // Extract flip flags
        const flipH = (rawGid & FLIPPED_HORIZONTALLY) !== 0;
        const flipV = (rawGid & FLIPPED_VERTICALLY) !== 0;
        const flipD = (rawGid & FLIPPED_DIAGONALLY) !== 0;
        const gid = rawGid & GID_MASK;

        // Get or create tile texture
        const texture = this.getTileTexture(gid);
        if (!texture) continue;

        const x = (i % gridW) * tw;
        const y = Math.floor(i / gridW) * ts;

        const sprite = new Sprite(texture);
        sprite.x = x;
        sprite.y = y;

        // Apply flip transforms
        if (flipH || flipV || flipD) {
          // Anchor at center for correct flip positioning
          sprite.anchor.set(0.5, 0.5);
          sprite.x += tw / 2;
          sprite.y += ts / 2;

          if (flipD) {
            // Diagonal flip = 90-degree rotation + horizontal flip
            sprite.rotation = Math.PI / 2;
            sprite.scale.x = flipH ? 1 : -1;
            sprite.scale.y = flipV ? -1 : 1;
          } else {
            sprite.scale.x = flipH ? -1 : 1;
            sprite.scale.y = flipV ? -1 : 1;
          }
        }

        layerContainer.addChild(sprite);
        this.sprites.push(sprite);
      }

      container.addChild(layerContainer);
    }
  }

  destroy(): void {
    for (const sprite of this.sprites) {
      sprite.destroy();
    }
    this.sprites = [];
    this.tileTextureCache.clear();
    this.resolved = [];
  }

  /**
   * Compute walkability from the Tiled layers.
   * Floor cells are walkable; cells with furniture/desks are blocked.
   * Border walls are blocked.
   */
  computeWalkability(): boolean[] {
    const { width: gridW, height: gridH } = this.tiledMap;
    const walkability = new Array<boolean>(gridW * gridH).fill(false);

    // Find layers by name
    const floorLayer = this.tiledMap.layers.find((l) => l.name === 'Floor');
    const blockingLayers = this.tiledMap.layers.filter((l) =>
      ['Desk', 'Kiosk', 'PreDeskStuff', 'Pre'].includes(l.name),
    );

    if (!floorLayer) return walkability;

    for (let i = 0; i < gridW * gridH; i++) {
      const x = i % gridW;
      const y = Math.floor(i / gridW);

      // Must have a floor tile
      const floorGid = floorLayer.data[i] & GID_MASK;
      if (floorGid === 0) {
        walkability[i] = false;
        continue;
      }

      // Border walls (rows 0-1 are wall face + bottom, col 0 and col 19)
      if (y <= 1 || x === 0 || x === gridW - 1) {
        walkability[i] = false;
        continue;
      }

      // Bottom wall (last row), except door opening
      if (y === gridH - 1) {
        walkability[i] = false;
        continue;
      }

      // Check if any blocking layer has a tile here
      let blocked = false;
      for (const layer of blockingLayers) {
        const gid = layer.data[i] & GID_MASK;
        if (gid !== 0) {
          blocked = true;
          break;
        }
      }

      walkability[i] = !blocked;
    }

    return walkability;
  }

  private getTileTexture(gid: number): Texture | null {
    const cached = this.tileTextureCache.get(gid);
    if (cached) return cached;

    // Find the tileset this GID belongs to
    const tileset = this.resolved.find(
      (ts) => gid >= ts.firstgid && gid <= ts.lastgid,
    );
    if (!tileset) return null;

    const localId = gid - tileset.firstgid;
    const col = localId % tileset.columns;
    const row = Math.floor(localId / tileset.columns);
    const ts = this.tiledMap.tileheight;

    const frame = new Rectangle(col * ts, row * ts, ts, ts);
    const texture = new Texture({ source: tileset.texture.source, frame });
    this.tileTextureCache.set(gid, texture);
    return texture;
  }
}
