import { useEffect, useRef } from 'react';
import { Application, Container } from 'pixi.js';
import { renderTileMap } from './TileMap.js';
import { AnimationController } from './AnimationController.js';

export function PixelOffice() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const app = new Application();
    const world = new Container();
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
      world.addChild(agentsLayer);
      app.stage.addChild(world);
      hostRef.current?.appendChild(app.canvas);

      controller = new AnimationController(app, agentsLayer);
      await controller.init();
    })();

    return () => {
      destroyed = true;
      controller?.destroy();
      app.destroy(true, { children: true });
      if (hostRef.current) {
        hostRef.current.innerHTML = '';
      }
    };
  }, []);

  return <div className="pixel-office" ref={hostRef} />;
}
