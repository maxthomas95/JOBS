import type { Point } from './agent.js';

export interface OfficeStations {
  door: Point;
  whiteboard: Point;
  terminal: Point;
  library: Point;
  coffee: Point;
  desks: Point[];
}

/** Shared geometry for both the Tiled art and procedural fallback. */
export const OFFICE_LAYOUT = {
  width: 20,
  height: 15,
  stations: {
    door: { x: 17, y: 13 },
    whiteboard: { x: 8, y: 12 },
    terminal: { x: 3, y: 12 },
    library: { x: 2, y: 2 },
    coffee: { x: 9, y: 12 },
    desks: [
      { x: 3, y: 2 }, { x: 6, y: 2 }, { x: 9, y: 2 }, { x: 12, y: 2 },
      { x: 3, y: 5 }, { x: 6, y: 5 }, { x: 9, y: 5 }, { x: 12, y: 5 },
      { x: 3, y: 7 }, { x: 6, y: 7 }, { x: 9, y: 7 }, { x: 12, y: 7 },
      { x: 3, y: 10 }, { x: 6, y: 10 }, { x: 9, y: 10 }, { x: 12, y: 10 },
      { x: 16, y: 8 }, // Reserved supervisor seat
    ],
  } satisfies OfficeStations,
};

/** Artwork includes chair backs and desk trim in collision layers. Explicit
 * access rows and the side aisle keep those decorative tiles from sealing seats. */
export function withWalkableStations(walkability: boolean[]): boolean[] {
  const result = [...walkability];
  for (const y of [2, 5, 7, 10]) {
    for (let x = 2; x <= 14; x++) result[y * OFFICE_LAYOUT.width + x] = true;
  }
  for (let y = 2; y <= 13; y++) result[y * OFFICE_LAYOUT.width + 14] = true;
  for (let x = 2; x <= 17; x++) result[12 * OFFICE_LAYOUT.width + x] = true;
  const { desks, ...stations } = OFFICE_LAYOUT.stations;
  for (const point of [...desks, ...Object.values(stations)]) {
    result[point.y * OFFICE_LAYOUT.width + point.x] = true;
  }
  return result;
}

export const FALLBACK_WALKABILITY = withWalkableStations(Array.from(
  { length: OFFICE_LAYOUT.width * OFFICE_LAYOUT.height },
  (_, i) => {
    const x = i % OFFICE_LAYOUT.width;
    const y = Math.floor(i / OFFICE_LAYOUT.width);
    // Furniture between facing seats; all seats remain reachable by side aisles.
    const desk = x >= 3 && x <= 13 && x % 3 !== 2 && [3, 4, 8, 9].includes(y);
    return x > 0 && x < 19 && y > 1 && y < 14 && !desk;
  },
));
