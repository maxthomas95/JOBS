import { useEffect, useRef, useState } from 'react';
import { Application, Container, Color } from 'pixi.js';
import { AnimationController } from './AnimationController.js';
import { DayNightCycle } from './DayNightCycle.js';
import { FollowMode } from './FollowMode.js';
import { BubbleOverlay } from '../ui/BubbleOverlay.js';
import { TiledMapRenderer } from './tileset/TiledMapRenderer.js';
import type { TiledMap } from './tileset/TiledMapRenderer.js';
import { ProceduralTilesetRenderer } from './tileset/ProceduralTilesetRenderer.js';
import type { TilesetRenderer } from './tileset/TilesetRenderer.js';
import { OFFICE_LAYOUT, FALLBACK_WALKABILITY, withWalkableStations } from '../types/office-layout.js';
import { setWalkabilityFromConfig } from './Pathfinder.js';
import type { MapConfig } from './tileset/MapConfig.js';
import tiledMapData from '../assets/maps/office-tiled.json';

import { useThemeStore } from '../state/useThemeStore.js';

// Import tileset images — Vite will resolve these to hashed URLs (or 404 if missing)
let officeSheetUrl: string | undefined;
let roomSheetUrl: string | undefined;
try {
  officeSheetUrl = new URL('../assets/tiles/Modern_Office_16x16.png', import.meta.url).href;
  roomSheetUrl = new URL('../assets/tiles/Room_Builder_Office_16x16.png', import.meta.url).href;
} catch {
  // Images not available — will use procedural fallback
}

export function PixelOffice() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderStatus, setRenderStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const app = new Application();
    const world = new Container();
    const ambientLayer = new Container();
    const agentsLayer = new Container();
    const dayNight = new DayNightCycle();

    let controller: AnimationController | null = null;
    let followMode: FollowMode | null = null;
    let tiledRenderer: TiledMapRenderer | null = null;
    let fallbackRenderer: TilesetRenderer | null = null;
    let destroyed = false;
    let initialized = false;
    let disposed = false;
    const dispose = () => {
      if (disposed || !initialized) return;
      disposed = true;
      controller?.destroy();
      followMode?.destroy();
      tiledRenderer?.destroy();
      fallbackRenderer?.destroy();
      dayNight.destroy();
      app.destroy(true, { children: true });
      canvasRef.current = null;
    };

    // Subscribe to theme changes for PixiJS background
    const unsubTheme = useThemeStore.subscribe(
      (s) => s.theme,
      (theme) => {
        try {
          app.renderer.background.color = new Color(theme.css.pixiBg);
        } catch {
          // Renderer not ready yet
        }
      },
    );

    void (async () => {
      const initialBg = useThemeStore.getState().theme.css.pixiBg;
      await app.init({
        width: 320,
        height: 240,
        background: initialBg,
        resolution: window.devicePixelRatio,
        autoDensity: true,
      });
      initialized = true;

      if (destroyed) {
        dispose();
        return;
      }

      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.imageRendering = 'pixelated';

      // Try Tiled renderer first, fall back to old MapConfig renderer
      const hasTilesetImages = officeSheetUrl && roomSheetUrl;

      if (hasTilesetImages) {
        try {
          const tiledMap = tiledMapData as unknown as TiledMap;

          // Tiled tilesets: firstgid 1 = Room Builder, firstgid 225 = Modern Office
          tiledRenderer = new TiledMapRenderer(tiledMap, [
            { firstgid: 1, url: roomSheetUrl! },
            { firstgid: 225, url: officeSheetUrl! },
          ]);
          await tiledRenderer.init();
          if (destroyed) { tiledRenderer.destroy(); return; }
          tiledRenderer.renderMap(world);

          // Set stations and walkability for the Tiled layout
          const walkability = withWalkableStations(tiledRenderer.computeWalkability());
          setWalkabilityFromConfig(walkability, tiledMap.width, tiledMap.height);

          console.log('[tileset] Using Tiled map renderer');
        } catch (err) {
          console.warn('[tileset] Tiled renderer failed, falling back:', err);
          tiledRenderer?.destroy();
          tiledRenderer = null;
        }
      }

      // Fallback to old MapConfig-based renderer
      if (!tiledRenderer) {
        const mapConfig: MapConfig = {
          name: 'Shared office fallback', gridWidth: OFFICE_LAYOUT.width,
          gridHeight: OFFICE_LAYOUT.height, tileSize: 16, tilesets: {}, layers: [],
          stations: OFFICE_LAYOUT.stations, walkability: FALLBACK_WALKABILITY,
        };
        setWalkabilityFromConfig(mapConfig.walkability, mapConfig.gridWidth, mapConfig.gridHeight);
        fallbackRenderer = new ProceduralTilesetRenderer();
        await fallbackRenderer.init();
        if (destroyed) { fallbackRenderer.destroy(); return; }
        fallbackRenderer.renderMap(world, mapConfig);
        console.log('[tileset] Using fallback MapConfig renderer');
      }

      world.addChild(dayNight.container);
      world.addChild(ambientLayer);
      world.addChild(agentsLayer);
      app.stage.addChild(world);
      hostRef.current?.appendChild(app.canvas);
      canvasRef.current = app.canvas;

      followMode = new FollowMode(app, world);
      controller = new AnimationController(app, agentsLayer, ambientLayer, dayNight, followMode);
      await controller.init();
      if (!destroyed) setRenderStatus('ready');
    })().catch(() => {
      if (!destroyed) setRenderStatus('error');
      dispose();
    });

    return () => {
      destroyed = true;
      unsubTheme();
      dispose();
    };
  }, []);

  return (
    <div className="pixel-office" ref={hostRef}>
      {renderStatus !== 'ready' && <div className="office-render-status" role="status">{renderStatus === 'loading' ? 'Opening the office…' : 'The office could not render. Session activity is still available in the roster.'}</div>}
      <BubbleOverlay canvasRef={canvasRef} />
    </div>
  );
}
