import { useEffect, useRef } from 'react';
import { Application, Container, Color } from 'pixi.js';
import { AnimationController } from './AnimationController.js';
import { DayNightCycle } from './DayNightCycle.js';
import { BubbleOverlay } from '../ui/BubbleOverlay.js';
import { createTilesetRenderer } from './tileset/createTilesetRenderer.js';
import type { TilesetRenderer } from './tileset/TilesetRenderer.js';
import { setStationsFromConfig } from '../types/agent.js';
import { setWalkabilityFromConfig } from './Pathfinder.js';
import type { MapConfig } from './tileset/MapConfig.js';
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
    let tilesetRenderer: TilesetRenderer | null = null;
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

      // Load map config and update STATIONS + pathfinding grid
      const mapConfig = officeConfig as MapConfig;
      setStationsFromConfig(mapConfig.stations);
      setWalkabilityFromConfig(mapConfig.walkability, mapConfig.gridWidth, mapConfig.gridHeight);

      // Create tileset renderer (auto-detects image vs procedural)
      const assetUrls: Record<string, string> = {};
      if (officeSheetUrl) assetUrls['office'] = officeSheetUrl;
      if (roomSheetUrl) assetUrls['room'] = roomSheetUrl;

      tilesetRenderer = await createTilesetRenderer(assetUrls);
      tilesetRenderer.renderMap(world, mapConfig);

      world.addChild(dayNight.container);
      world.addChild(ambientLayer);
      world.addChild(agentsLayer);
      app.stage.addChild(world);
      hostRef.current?.appendChild(app.canvas);
      canvasRef.current = app.canvas;

      controller = new AnimationController(app, agentsLayer, ambientLayer, dayNight);
      await controller.init();
    })();

    return () => {
      destroyed = true;
      unsubTheme();
      controller?.destroy();
      tilesetRenderer?.destroy();
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
