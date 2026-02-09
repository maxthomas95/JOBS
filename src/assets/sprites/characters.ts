import type { SpritesheetData } from 'pixi.js';

const SHEET_WIDTH = 384;
const SHEET_HEIGHT = 256;
const CHARACTER_WIDTH = 96;
const CHARACTER_HEIGHT = 128;
const FRAME_SIZE = 32;

function buildCharacterData(characterIndex: number): SpritesheetData {
  const row = Math.floor(characterIndex / 4);
  const col = characterIndex % 4;
  const originX = col * CHARACTER_WIDTH;
  const originY = row * CHARACTER_HEIGHT;

  const frames: SpritesheetData['frames'] = {};
  const animations: SpritesheetData['animations'] = {
    down: [],
    left: [],
    right: [],
    up: [],
  };

  const dirs = ['down', 'left', 'right', 'up'] as const;

  for (let dirIndex = 0; dirIndex < dirs.length; dirIndex += 1) {
    for (let frame = 0; frame < 3; frame += 1) {
      const name = `${dirs[dirIndex]}_${frame}`;
      frames[name] = {
        frame: {
          x: originX + frame * FRAME_SIZE,
          y: originY + dirIndex * FRAME_SIZE,
          w: FRAME_SIZE,
          h: FRAME_SIZE,
        },
        sourceSize: { w: FRAME_SIZE, h: FRAME_SIZE },
        spriteSourceSize: { x: 0, y: 0, w: FRAME_SIZE, h: FRAME_SIZE },
      };
      animations[dirs[dirIndex]].push(name);
    }
  }

  return {
    frames,
    animations,
    meta: {
      scale: '1',
      format: 'RGBA8888',
      image: '32x32folk.png',
      size: { w: SHEET_WIDTH, h: SHEET_HEIGHT },
    },
  };
}

export const characterData = Array.from({ length: 8 }, (_, i) => buildCharacterData(i));
