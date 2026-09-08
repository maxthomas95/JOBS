import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OFFICE_LAYOUT, FALLBACK_WALKABILITY, withWalkableStations } from '../src/types/office-layout.js';
import { TiledMapRenderer, type TiledMap } from '../src/engine/tileset/TiledMapRenderer.js';
import { SessionManager } from '../server/session-manager.js';

test('both map renderers have reachable shared destinations and 16 regular seats', (t) => {
  const map = JSON.parse(readFileSync(new URL('../src/assets/maps/office-tiled.json', import.meta.url), 'utf8')) as TiledMap;
  const tiled = withWalkableStations(new TiledMapRenderer(map, []).computeWalkability());
  const { width, height, stations } = OFFICE_LAYOUT;
  for (const [name, walkability] of [['tiled', tiled], ['fallback', FALLBACK_WALKABILITY]] as const) {
    assert.equal(walkability.length, width * height);
    const first = stations.door.y * width + stations.door.x;
    const visited = new Set([first]);
    const queue = [first];
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i];
      const x = at % width;
      for (const next of [at - width, at + width, ...(x > 0 ? [at - 1] : []), ...(x < width - 1 ? [at + 1] : [])]) {
        if (next >= 0 && next < width * height && walkability[next] && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    const { desks, ...destinations } = stations;
    for (const point of [...desks, ...Object.values(destinations)]) {
      assert.ok(visited.has(point.y * width + point.x), `${name}: unreachable ${point.x},${point.y}`);
    }
  }
  const manager = new SessionManager();
  t.after(() => manager.dispose());
  const assigned = Array.from({ length: 17 }, (_, i) => manager.registerWebhookAgent(`seat-${i}`, {}));
  assert.deepEqual(assigned.slice(0, 16).map(agent => agent.deskIndex), Array.from({ length: 16 }, (_, i) => i));
  assert.equal(assigned[16].deskIndex, null);
  assert.equal(stations.desks.length, 17);
});
