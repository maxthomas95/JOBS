import type { TilesetRenderer } from './TilesetRenderer.js';
import { ImageTilesetRenderer } from './ImageTilesetRenderer.js';
import { ProceduralTilesetRenderer } from './ProceduralTilesetRenderer.js';

/**
 * Attempt to load the LimeZu spritesheets. If available, return an ImageTilesetRenderer.
 * Otherwise, fall back to ProceduralTilesetRenderer.
 */
export async function createTilesetRenderer(
  assetUrls: Record<string, string>,
): Promise<TilesetRenderer> {
  try {
    if (Object.keys(assetUrls).length === 0) {
      throw new Error('No asset URLs provided');
    }

    // Try creating the image renderer — init() loads all spritesheets
    // and will throw if any are missing (404)
    const renderer = new ImageTilesetRenderer(assetUrls);
    await renderer.init();
    console.log('[tileset] Using image-based renderer (LimeZu)');
    return renderer;
  } catch {
    console.log('[tileset] LimeZu spritesheet not found, using procedural fallback');
    const renderer = new ProceduralTilesetRenderer();
    await renderer.init();
    return renderer;
  }
}
