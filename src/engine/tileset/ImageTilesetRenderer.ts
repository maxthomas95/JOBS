import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { TilesetRenderer } from './TilesetRenderer.js';
import type { MapConfig } from './MapConfig.js';

/**
 * Renders a tilemap using LimeZu spritesheet images.
 * Slices the spritesheet into 16x16 tile textures and paints layers.
 */
export class ImageTilesetRenderer implements TilesetRenderer {
  /** Base textures keyed by tileset ID. */
  private baseTextures = new Map<string, Texture>();
  /** Tile textures keyed by "tilesetId:tileId". */
  private tileTextures = new Map<string, Texture>();
  /** Sprites created during rendering, for cleanup. */
  private sprites: Sprite[] = [];

  constructor(private readonly assetUrls: Record<string, string>) {}

  async init(): Promise<void> {
    for (const [tilesetId, url] of Object.entries(this.assetUrls)) {
      const texture = await Assets.load<Texture>(url);
      this.baseTextures.set(tilesetId, texture);
    }
  }

  renderMap(container: Container, mapConfig: MapConfig): void {
    // Build tile textures from the base textures using tileset definitions
    this.buildTileTextures(mapConfig);

    // Render each layer
    for (const layer of mapConfig.layers) {
      const layerContainer = new Container();
      layerContainer.label = layer.name;
      for (let i = 0; i < layer.data.length; i++) {
        const ref = layer.data[i];
        if (ref === null) continue;

        const texture = this.tileTextures.get(ref);
        if (!texture) continue;

        const x = (i % mapConfig.gridWidth) * mapConfig.tileSize;
        const y = Math.floor(i / mapConfig.gridWidth) * mapConfig.tileSize;

        const sprite = new Sprite(texture);
        sprite.x = x;
        sprite.y = y;
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
    this.tileTextures.clear();
    this.baseTextures.clear();
  }

  private buildTileTextures(mapConfig: MapConfig): void {
    for (const [tilesetId, def] of Object.entries(mapConfig.tilesets)) {
      const baseTexture = this.baseTextures.get(tilesetId);
      if (!baseTexture) continue;

      const source = baseTexture.source;

      for (const [tileId, coords] of Object.entries(def.tiles)) {
        const key = `${tilesetId}:${tileId}`;
        if (this.tileTextures.has(key)) continue;

        const frame = new Rectangle(
          coords.col * def.tileSize,
          coords.row * def.tileSize,
          def.tileSize,
          def.tileSize,
        );
        const texture = new Texture({ source, frame });
        this.tileTextures.set(key, texture);
      }
    }
  }
}
