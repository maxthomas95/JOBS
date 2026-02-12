import { useEffect, useRef } from 'react';
import { Application, Container } from 'pixi.js';
import { renderTileMap } from './TileMap.js';
import { AnimationController } from './AnimationController.js';
import { BubbleOverlay } from '../ui/BubbleOverlay.js';

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

    let controller: AnimationController | null = null;
    let destroyed = false;

    void (async () => {
      await app.init({
        width: 320,
        height: 240,
        background: '#2a2a3e',
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

      renderTileMap(world);
      world.addChild(ambientLayer);
      world.addChild(agentsLayer);
      app.stage.addChild(world);
      hostRef.current?.appendChild(app.canvas);
      canvasRef.current = app.canvas;

      controller = new AnimationController(app, agentsLayer, ambientLayer);
      await controller.init();
    })();

    return () => {
      destroyed = true;
      controller?.destroy();
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
