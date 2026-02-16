import { useEffect, useRef } from 'react';
import { Application, Container, Color } from 'pixi.js';
import { AnimationController } from './AnimationController.js';
import { DayNightCycle } from './DayNightCycle.js';
import { ScreensaverMode } from './ScreensaverMode.js';
import { BubbleOverlay } from '../ui/BubbleOverlay.js';
import { TiledMapRenderer } from './tileset/TiledMapRenderer.js';
import type { TiledMap } from './tileset/TiledMapRenderer.js';
import { createTilesetRenderer } from './tileset/createTilesetRenderer.js';
import type { TilesetRenderer } from './tileset/TilesetRenderer.js';
import { setStationsFromConfig } from '../types/agent.js';
import { setWalkabilityFromConfig } from './Pathfinder.js';
import type { MapConfig } from './tileset/MapConfig.js';
import tiledMapData from '../assets/maps/office-tiled.json';
import officeConfig from '../assets/maps/office-default.json';
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

/** Station positions for the Tiled map layout. */
const TILED_STATIONS = {
  door: { x: 17, y: 13 },
  whiteboard: { x: 8, y: 12 },   // open area — thinking/planning
  terminal: { x: 3, y: 12 },     // bottom-left desk
  library: { x: 2, y: 2 },       // top-left bookcase (reading)
  coffee: { x: 9, y: 12 },       // coffee maker (idle/waiting)
  desks: [
    // Desk Row 1 — top seats (agents above desk, facing down)
    { x: 3, y: 2 }, { x: 6, y: 2 }, { x: 9, y: 2 }, { x: 12, y: 2 },
    // Desk Row 1 — bottom seats (agents below desk, facing up)
    { x: 3, y: 5 }, { x: 6, y: 5 }, { x: 9, y: 5 }, { x: 12, y: 5 },
    // Desk Row 2 — top seats (agents above desk, facing down)
    { x: 3, y: 7 }, { x: 6, y: 7 }, { x: 9, y: 7 }, { x: 12, y: 7 },
    // Desk Row 2 — bottom seats (agents below desk, facing up)
    { x: 3, y: 10 }, { x: 6, y: 10 }, { x: 9, y: 10 }, { x: 12, y: 10 },
    // Supervisor desk (right side, isolated)
    { x: 16, y: 8 },
  ],
};

export function PixelOffice() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    let screensaver: ScreensaverMode | null = null;
    let tiledRenderer: TiledMapRenderer | null = null;
    let fallbackRenderer: TilesetRenderer | null = null;
    let destroyed = false;

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

      if (destroyed) {
        app.destroy(true, { children: true });
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
          tiledRenderer.renderMap(world);

          // Set stations and walkability for the Tiled layout
          setStationsFromConfig(TILED_STATIONS);
          const walkability = tiledRenderer.computeWalkability();
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
        const mapConfig = officeConfig as MapConfig;
        setStationsFromConfig(mapConfig.stations);
        setWalkabilityFromConfig(mapConfig.walkability, mapConfig.gridWidth, mapConfig.gridHeight);

        const assetUrls: Record<string, string> = {};
        if (officeSheetUrl) assetUrls['office'] = officeSheetUrl;
        if (roomSheetUrl) assetUrls['room'] = roomSheetUrl;

        fallbackRenderer = await createTilesetRenderer(assetUrls);
        fallbackRenderer.renderMap(world, mapConfig);
        console.log('[tileset] Using fallback MapConfig renderer');
      }

      world.addChild(dayNight.container);
      world.addChild(ambientLayer);
      world.addChild(agentsLayer);
      app.stage.addChild(world);
      hostRef.current?.appendChild(app.canvas);
      canvasRef.current = app.canvas;

      screensaver = new ScreensaverMode(app, world);
      controller = new AnimationController(app, agentsLayer, ambientLayer, dayNight, screensaver);
      await controller.init();
    })();

    return () => {
      destroyed = true;
      unsubTheme();
      controller?.destroy();
      screensaver?.destroy();
      tiledRenderer?.destroy();
      fallbackRenderer?.destroy();
      dayNight.destroy();
      app.destroy(true, { children: true });
      canvasRef.current = null;
      if (hostRef.current) {
        hostRef.current.innerHTML = '';
      }
    };
  }, []);

  return (
    <div className="pixel-office" ref={hostRef}>
      <BubbleOverlay canvasRef={canvasRef} />
    </div>
  );
}
