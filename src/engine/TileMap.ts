import { Container, Graphics } from 'pixi.js';
import { STATIONS, TILE_SIZE } from '../types/agent.js';

const OFFICE_WIDTH = 20 * TILE_SIZE;
const OFFICE_HEIGHT = 15 * TILE_SIZE;

export function renderTileMap(container: Container): void {
  const g = new Graphics();

  g.rect(0, 0, OFFICE_WIDTH, OFFICE_HEIGHT).fill(0x2e3138);

  g.rect(0, 0, OFFICE_WIDTH, TILE_SIZE).fill(0x1f2127);
  g.rect(0, 0, TILE_SIZE, OFFICE_HEIGHT).fill(0x1f2127);
  g.rect(OFFICE_WIDTH - TILE_SIZE, 0, TILE_SIZE, OFFICE_HEIGHT).fill(0x1f2127);
  g.rect(0, OFFICE_HEIGHT - TILE_SIZE, OFFICE_WIDTH, TILE_SIZE).fill(0x1f2127);

  for (const desk of STATIONS.desks) {
    const x = desk.x * TILE_SIZE;
    const y = desk.y * TILE_SIZE;
    g.rect(x, y, TILE_SIZE * 2, TILE_SIZE).fill(0x6f4e37);
    g.rect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6).fill(0x89a8c7);
  }

  g.rect(STATIONS.whiteboard.x * TILE_SIZE, STATIONS.whiteboard.y * TILE_SIZE, TILE_SIZE * 3, TILE_SIZE).fill(0xf1f4f8);

  g.rect(STATIONS.terminal.x * TILE_SIZE, STATIONS.terminal.y * TILE_SIZE, TILE_SIZE * 2, TILE_SIZE).fill(0x111722);
  g.rect(STATIONS.terminal.x * TILE_SIZE + 1, STATIONS.terminal.y * TILE_SIZE + 1, TILE_SIZE * 2 - 2, TILE_SIZE - 2).stroke({ color: 0x2ee65e, width: 1 });

  // Library / bookshelf
  g.rect(STATIONS.library.x * TILE_SIZE, STATIONS.library.y * TILE_SIZE, TILE_SIZE * 3, TILE_SIZE).fill(0x5c3a1e);
  g.rect(STATIONS.library.x * TILE_SIZE + 2, STATIONS.library.y * TILE_SIZE + 3, TILE_SIZE - 4, TILE_SIZE - 6).fill(0xd4a574);
  g.rect(STATIONS.library.x * TILE_SIZE + TILE_SIZE + 2, STATIONS.library.y * TILE_SIZE + 3, TILE_SIZE - 4, TILE_SIZE - 6).fill(0xc49a6c);
  g.rect(STATIONS.library.x * TILE_SIZE + TILE_SIZE * 2 + 2, STATIONS.library.y * TILE_SIZE + 3, TILE_SIZE - 4, TILE_SIZE - 6).fill(0xb8906a);

  // Coffee machine
  g.rect(STATIONS.coffee.x * TILE_SIZE, STATIONS.coffee.y * TILE_SIZE, TILE_SIZE * 2, TILE_SIZE).fill(0x3d2b1f);
  g.rect(STATIONS.coffee.x * TILE_SIZE + 3, STATIONS.coffee.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4).fill(0x8b4513);

  g.rect(STATIONS.door.x * TILE_SIZE, STATIONS.door.y * TILE_SIZE, TILE_SIZE, TILE_SIZE).stroke({ color: 0xe3d7c0, width: 1 });

  container.addChild(g);
}
