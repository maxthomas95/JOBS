# Tileset Analysis Report

**Date:** February 15, 2026
**Status:** Open — evaluating approaches

---

## Problem Summary

The current office rendering looks sparse and half-built compared to the LimeZu reference images (e.g., `images/Modern_Office_Revamped_v1.2/6_Office_Designs/Office_Design_2.gif`). The reference shows dense, lively workstations with monitors on desks, keyboards, mugs, wall art on every surface, plants in corners, etc. Our implementation has bare desks, floating monitors, empty walls, and obvious tiling.

---

## Root Causes

### 1. Only 3 Layers (THE BIG ONE)

The map config (`office-default.json`) defines 3 layers: `floor`, `walls`, `furniture`. Each grid cell holds exactly ONE tile per layer. This makes it **impossible** to stack items:

- Cannot place a monitor ON a desk (desk occupies the furniture cell)
- Cannot place a keyboard ON a desk (same)
- Cannot place a clock ON a wall (wall occupies the wall cell)

The reference image was composed in **Aseprite** with unlimited layering. A proper tile map editor (Tiled) uses **5-8+ layers**:

| Layer | Purpose | Example Tiles |
|-------|---------|---------------|
| 1. Floor base | Office floor | `floor-gray` |
| 2. Floor detail | Rugs, sections | `floor-tile` in lobby |
| 3. Walls | Wall faces | `wall-face-gray` |
| 4. Wall decor | Items ON walls | `art-frame1`, `clock`, `whiteboard` |
| 5. Furniture base | Desks, tables | `long-desk-l/m/r` |
| 6. Furniture items | Items ON furniture | `monitor-blue-l/r`, `laptop`, `mug` |
| 7. Chairs/front | Items in front | `chair-gray-l/r` |

**Note:** The renderer (`ImageTilesetRenderer.renderMap`) already iterates layers dynamically — it supports N layers out of the box. The 3-layer limit is only in the map JSON.

### 2. No Visual Editor (Why AI Can't Fix This)

The map is a flat JSON array of 300 entries per layer, hand-authored. Zero visual feedback. Editing is like painting by typing coordinates — essentially impossible to get right for 60+ tile types across hundreds of cells.

The reference was built in Aseprite (visual). The LimeZu tileset is designed for Tiled Map Editor (visual). Neither workflow involves hand-editing JSON arrays.

### 3. Not Using Enough Available Tiles

`tileset-limezu.json` defines ~130+ tile IDs. `office-default.json` uses ~40. Missing tiles that would add richness:

- `desk-divider-*` (9 tiles) — partition walls between workstations
- `cubicle-wall-*`, `cubicle-desk-*` — cubicle furniture
- `filing-cabinet-*` — 4-tile filing cabinets
- `locker-*` — 4-tile lockers
- `couch-*` — lounge furniture (8 tiles)
- `server-rack-*` — server equipment
- `mug`, `phone`, `clock` — desk/wall accessories
- `monitor-dual-*`, `monitor-wide-*`, `monitor-big-*` — monitor variety
- `pc-tower-*`, `pc-blue-*` — PC variety
- `whiteboard-stand-*` — standing whiteboard
- `desk-wood-*`, `desk-dark-*` — desk variety
- `divider-*` — room dividers

---

## Approach Options

### Option A: Quick Fix — Add More Layers to JSON (1-2 hours)

Add layers to `office-default.json` (renderer already supports it):
- `furniture-top` for monitors/items ON desks
- `wall-decor` for items on walls

**Pros:** Fast, no new tools, immediate improvement in density.
**Cons:** Still hand-editing JSON arrays (tedious, error-prone). Doesn't solve the authoring problem.

### Option B: Use Tiled Map Editor (Recommended — half-day)

1. Download [Tiled](https://www.mapeditor.org/) (free, open source, Windows)
2. Import both LimeZu spritesheets as tilesets
3. Design the office visually with 6-7 layers
4. Export as JSON
5. Write a Tiled JSON -> MapConfig adapter (or modify renderer to read Tiled JSON directly)

**Pros:** Visual editing, unlimited layers, designed for exactly this workflow, Tiled JSON is well-documented.
**Cons:** New tool to learn, need adapter code, Tiled JSON format differs from current MapConfig.

### Option C: Hybrid — Tiled for Authoring, Custom Format for Runtime

Use Tiled to design, but write a build-time converter (`tiled-to-jobs.ts`) that transforms Tiled JSON into our MapConfig format. Keep the existing renderer unchanged.

**Pros:** Best of both worlds — visual editing + existing renderer.
**Cons:** Extra build step, converter maintenance.

---

## Moonshot Alignment (Live Room Editor)

The Live Room Editor moonshot in VISION.md essentially IS a simplified Tiled built into the browser. Considerations:

- **Current 3-layer flat-array approach is a dead end** for the moonshot
- The moonshot needs: furniture palette, drag-and-drop, dynamic pathfinding, station auto-registration, layout persistence
- **Tiled's JSON format could serve as the reference implementation** for the Live Room Editor's save format
- A `FurnitureObject` model (name, tile footprint, station type, z-layer) would be needed long-term
- Using Tiled NOW doesn't conflict with the moonshot — it provides a working reference

---

## Architecture Notes

### Current Rendering Pipeline
```
office-default.json (3 layers, flat arrays)
  -> MapConfig type (parsed)
  -> createTilesetRenderer() (tries image, falls back to procedural)
  -> ImageTilesetRenderer.renderMap()
     -> buildTileTextures() — slices spritesheets into 16x16 Textures
     -> For each layer: create Container, place Sprites at grid positions
  -> Rendered into PixelOffice world Container
```

### Key Files
- `src/engine/tileset/ImageTilesetRenderer.ts` — spritesheet renderer (works with N layers)
- `src/engine/tileset/ProceduralTilesetRenderer.ts` — colored rectangles fallback
- `src/engine/tileset/createTilesetRenderer.ts` — factory with fallback
- `src/engine/tileset/MapConfig.ts` — type definitions
- `src/assets/maps/office-default.json` — current map (3 layers)
- `src/assets/maps/tileset-limezu.json` — full tile catalog (~130 IDs)
- `src/assets/tiles/Modern_Office_16x16.png` — furniture spritesheet
- `src/assets/tiles/Room_Builder_Office_16x16.png` — walls/floors spritesheet

### Spritesheets
- **Room Builder** (`Room_Builder_Office_16x16.png`) — 16 columns, walls + floors
- **Modern Office** (`Modern_Office_16x16.png`) — 16 columns, all furniture/decor
- Both are in `src/assets/tiles/` (gitignored — user drops in LimeZu PNGs)
- Source copies in `images/Modern_Office_Revamped_v1.2/`

---

## Decision Log

| Date | Decision | Notes |
|------|----------|-------|
| 2026-02-15 | Analysis complete | Evaluating Tiled vs hand-edit approaches |
| | | |
