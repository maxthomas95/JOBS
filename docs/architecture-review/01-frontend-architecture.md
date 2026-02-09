# 01 — Frontend Architecture Review: PixiJS + React + Zustand

**Reviewer:** Rendering & Frontend Engineer
**Date:** February 8, 2026

---

## 1. @pixi/react v8 Stability

**Verdict: BLOCKING ISSUE — React version mismatch.**

VISION.md specifies **React 18** (line 152: "React 18 + TypeScript | 18.x"), but `@pixi/react v8` (current: v8.0.5, released Dec 2025) is **designed exclusively for React 19**. The v8 rewrite uses a new JSX pragma and internal APIs that depend on React 19's architecture.

**Known issues:**
- **Strict mode crash** ([Issue #602](https://github.com/pixijs/pixi-react/issues/602)): In dev mode, React strict mode double-rendering causes pixi-react to reference a stale WebGL context. Nothing renders until window resize. This won't affect production builds but will make development painful.
- **Memoized component renders after unmount** ([Issue #521](https://github.com/pixijs/pixi-react/issues/521)): Edge case with component lifecycle.

**Recommendation: Update VISION.md to React 19.** The jump from 18 to 19 is non-breaking for this greenfield project. Alternatively, use `@pixi/react` v7 with React 18, but that ties you to PixiJS v7 and misses v8's performance improvements. Given this is greenfield, React 19 is the correct call.

**For the strict mode issue:** Disable `<StrictMode>` wrapping around the PixiJS canvas component during development, or accept the dev-only quirk.

---

## 2. A* Pathfinding on 20x15 Grid with 10+ Agents

**Verdict: No concerns whatsoever.**

The `pathfinding` npm package (v0.4.18) implements A*, JPS, and other algorithms. A 20x15 grid = 300 nodes. A* on 300 nodes completes in microseconds — well under 1ms even on low-end hardware. Even with 10 agents recalculating paths every frame (which they won't need to), this is trivially cheap.

**Path caching:** Not necessary for performance, but worth implementing for **visual consistency** — you don't want an agent's path to flicker if recalculated every tick. Calculate path once when destination changes, then walk it.

**Note on the `pathfinding` package:** It hasn't been updated in 10 years. This is fine — the algorithm is mathematically stable and the API is simple. But if you want a maintained alternative, **EasyStar.js** (~7KB, async-capable, TypeScript support, 3.4K weekly downloads) is worth considering. Its async mode can split pathfinding across frames, which is overkill for this grid size but would be relevant if you ever scaled up.

**Recommendation: Keep `pathfinding` npm package. No changes needed.** Cache paths per-agent and recalculate only on destination change.

---

## 3. Sprite Sheet Loading (a16z/ai-town Sprites)

**Verdict: Minor reprocessing needed, but straightforward.**

The ai-town sprites use a shared spritesheet (`32x32folk.png`) with per-character TypeScript data files (e.g., `f1.ts` through `f8.ts`). Each file defines:
- **Frame size:** 32x32 pixels per frame
- **Directions:** 4 (left, right, up, down), each at a different y-offset
- **Walk cycle:** 3 frames per direction (e.g., `['left', 'left2', 'left3']`)
- **Total:** 12 frames per character (4 directions x 3 frames)

**Gotchas for PixiJS 8:**
1. **Format conversion needed.** The ai-town spritesheet data is in a custom TypeScript format, not PixiJS's expected JSON atlas format. You'll need to either:
   - Convert to PixiJS `Spritesheet` JSON format (with `frames`, `animations`, and `meta` sections), or
   - Manually create `PIXI.Texture` regions from the base texture using `new Texture({ source, frame: new Rectangle(x, y, 32, 32) })`.

   Recommend **option A** — write a small build-time script that converts the ai-town `.ts` data files into PixiJS-compatible JSON atlas files. This gives you proper `AnimatedSprite` support with `sheet.animations["walk_left"]`.

2. **Shared spritesheet.** All 8 characters share one PNG (`32x32folk.png`). This is actually ideal for PixiJS — single texture atlas = single WebGL draw call batching opportunity.

3. **3-frame walk cycles are minimal.** They'll look "retro" (which fits the pixel-art aesthetic), but consider whether the idle/typing/reading animations need more frames. The ai-town sprites only have walk animations — you'll need to **create or fake** sitting, typing, reading, and scribbling animations. Options:
   - Use a single static frame (front-facing) for "sitting at desk" states
   - Add a simple 2-frame bob animation for "typing" (offset the sprite 1px up/down)
   - The walk cycle doubles as movement between stations

**Recommendation: Write a spritesheet converter script in M1. Plan for limited animation variety from these sprites — the v1.5 upgrade to LimeZu + PixelLab.ai will be important for visual quality.**

---

## 4. WebGL Context Management

**Verdict: Manageable, but needs explicit handling.**

**Single canvas with React HUD overlay:** This is the correct architecture. The PixiJS canvas sits in a `<div>` and the React HUD is an absolutely-positioned overlay with `pointer-events: none` (except on interactive elements). No z-index issues — standard CSS stacking.

**Context loss:** PixiJS 8 has **ongoing issues** with WebGL context loss recovery. Specifically:
- [Issue #11685](https://github.com/pixijs/pixijs/issues/11685) (Sept 2025): Text disappears after context loss/restore in v8.13.2
- Historical issues (#6494, #7206, #5386): Sprites/graphics don't fully recover after context loss

Context loss happens when:
- Browser tabs are backgrounded for extended periods (mobile and some desktop browsers)
- GPU pressure from other applications
- Plugging/unplugging external monitors

**For J.O.B.S. specifically:** This is a dashboard meant to run on a wall-mounted display ("screensaver mode" is in the v2 roadmap). Extended backgrounding is less likely, but GPU pressure recovery matters.

**Recommendation:**
1. Add a `webglcontextlost` event listener that shows a "Reconnecting..." overlay
2. On `webglcontextrestored`, force a full re-render of the tilemap and all sprites
3. Consider adding a visibility change listener (`document.visibilitychange`) to pause the PixiJS ticker when the tab is hidden and resume when visible — this saves GPU resources and avoids context loss from backgrounding

---

## 5. Animation Frame Management

**Verdict: Use PixiJS Ticker. Do NOT mix with React render loop.**

The PixiJS `Ticker` is built on `requestAnimationFrame` internally and provides `deltaTime` and `elapsedMS` for frame-rate-independent animation. The architecture should be:

- **PixiJS Ticker** drives: sprite movement (interpolation along A* paths), walk cycle frame animation, ambient effects (screen glow, steam)
- **React render cycle** drives: HUD updates (agent roster, activity feed, connection status)
- **These must NOT be coupled.** PixiJS rendering should never trigger React re-renders, and React re-renders should never force PixiJS to redraw.

**Concrete pattern:**
```typescript
Ticker.shared.add((ticker) => {
  const dt = ticker.deltaTime;
  // Read latest state from Zustand (imperative, no React)
  const agents = useOfficeStore.getState().agents;
  // Update sprite positions, animations
  agents.forEach(agent => updateAgentSprite(agent, dt));
});
```

**Recommendation: Document this pattern explicitly in the codebase.** The `AnimationController.ts` file in the architecture (line 197) is the right place. It should own the ticker callback and be the sole bridge between Zustand state and PixiJS sprite positions.

---

## 6. Phaser vs PixiJS

**Verdict: PixiJS is the correct choice. Do not switch to Phaser.**

| Factor | PixiJS | Phaser |
|--------|--------|--------|
| Bundle size | ~450KB | ~1.2MB |
| Rendering perf | 2x faster (pure rendering) | Good but heavier |
| Tilemap support | Needs `@pixi/tilemap` or manual | Built-in (Tiled JSON) |
| Pathfinding | External lib needed | External lib needed |
| React integration | `@pixi/react` (official) | No official React binding |
| Animation | `AnimatedSprite` | Built-in Sprite + Tween |
| Physics | None (not needed) | Arcade/Matter.js (not needed) |
| Scene management | Manual | Built-in |

**Why PixiJS wins for J.O.B.S.:**
1. **React integration is critical.** The HUD overlay (roster, feed, controls) is React. Phaser has no official React binding — you'd be fighting framework conflicts.
2. **No physics needed.** Agents move on pre-calculated A* paths. Phaser's biggest advantage (built-in physics) is irrelevant.
3. **Bundle size matters for a dashboard.** 450KB vs 1.2MB. This runs on a browser tab that stays open.
4. **J.O.B.S. is a visualization, not a game.** PixiJS's "rendering library" philosophy is a better fit than Phaser's "game framework" philosophy.

**One thing Phaser would save:** Built-in tilemap loading from Tiled JSON. With PixiJS, you'll need to either hand-code the tilemap (fine for a 20x15 grid) or use `@pixi/tilemap`. Given the simple grid layout in VISION.md, hand-coding is faster.

**Recommendation: Keep PixiJS. For the tilemap, hand-code tile positions in `TileMap.ts` using a 2D array — don't over-engineer with Tiled for a 20x15 static layout.**

---

## 7. Zustand + PixiJS Bridge

**Verdict: Zustand is ideal for this — use `subscribe` + `getState`, not React hooks.**

Zustand uniquely supports **imperative access outside React components** via:
- `useOfficeStore.getState()` — read state synchronously from anywhere (ticker callback, animation controller)
- `useOfficeStore.subscribe(callback)` — react to state changes imperatively
- `zustand/vanilla` — create stores with zero React dependency

**Recommended bridge pattern:**

```typescript
// In AnimationController.ts (NOT a React component)
import { useOfficeStore } from '../state/useOfficeStore';

class AnimationController {
  private unsubscribe: () => void;

  init() {
    // Subscribe to agent state changes imperatively
    this.unsubscribe = useOfficeStore.subscribe(
      (state) => state.agents,
      (agents, prevAgents) => {
        // Only runs when agents array changes
        this.syncSprites(agents, prevAgents);
      }
    );
  }

  // Called from PixiJS ticker — no React involvement
  update(dt: number) {
    const { agents } = useOfficeStore.getState();
    this.interpolateMovement(agents, dt);
  }

  destroy() {
    this.unsubscribe();
  }
}
```

**Key insight:** Use `subscribeWithSelector` middleware for fine-grained subscriptions. This avoids re-syncing sprites when unrelated state (like audio settings) changes.

**What to avoid:**
- Do NOT use `useOfficeStore()` (the React hook) inside PixiJS components — this forces React reconciliation on every state change
- Do NOT pass state through React props to PixiJS components — this defeats the purpose of the imperative bridge
- The `@pixi/react` JSX components (like `<pixiSprite>`) go through React reconciliation by design — use them only for **static** elements (tilemap, UI decorations), not for agent sprites that update every frame

**Recommendation: Use `@pixi/react` `<Application>` to mount the canvas, but manage all agent sprites imperatively via `AnimationController` + Zustand `getState()`/`subscribe()`. This gives you React's lifecycle for setup/teardown while keeping the hot loop (60fps agent movement) completely outside React.**

---

## Summary of Changes Before M1

| Priority | Change | Impact |
|----------|--------|--------|
| **BLOCKING** | Update React 18 to React 19 in VISION.md | `@pixi/react` v8 requires React 19 |
| **HIGH** | Add spritesheet conversion step to M1 | ai-town sprites need format conversion for PixiJS |
| **HIGH** | Document the Zustand-PixiJS bridge pattern | Prevents React reconciliation bottleneck |
| **MEDIUM** | Add WebGL context loss handling to M5 | Important for long-running dashboard |
| **MEDIUM** | Plan for limited animation states from ai-town sprites | Only walk cycles available; sitting/typing must be faked |
| **LOW** | Consider disabling React StrictMode around canvas | Avoids dev-mode pixi-react crash |

**Sources referenced:**
- [PixiJS React v8 announcement](https://pixijs.com/blog/pixi-react-v8-live)
- [pixi-react strict mode issue #602](https://github.com/pixijs/pixi-react/issues/602)
- [pixi-react React 19 issue #551](https://github.com/pixijs/pixi-react/issues/551)
- [PixiJS WebGL context loss #11685](https://github.com/pixijs/pixijs/issues/11685)
- [PixiJS Render Loop docs](https://pixijs.com/8.x/guides/concepts/render-loop)
- [Phaser vs PixiJS comparison](https://generalistprogrammer.com/comparisons/phaser-vs-pixijs)
- [Zustand README — usage outside React](https://github.com/pmndrs/zustand)
- [a16z/ai-town characters.ts](https://github.com/a16z-infra/ai-town/blob/main/data/characters.ts)
- [pathfinding npm](https://www.npmjs.com/package/pathfinding)
- [EasyStar.js](https://easystarjs.com/)
