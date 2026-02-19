# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**J.O.B.S. (Jarvis Operations & Bot Surveillance)** — a self-hosted, browser-based pixel-art office that visualizes Claude Code agent activity in real-time. Each active coding session spawns a character who moves between stations (desk, whiteboard, terminal, library, coffee machine). Part of the Jarvis AI assistant ecosystem.

## Tech Stack

- **Frontend:** React 19 + TypeScript + PixiJS 8 (imperative API) + Zustand 5
- **Backend:** Node.js + Express (static serving) + ws (WebSocket)
- **Build:** Vite 6
- **File watching:** chokidar 5 (monitors `~/.claude/projects/` with ignored filter)
- **Pathfinding:** pathfinding (A* grid)
- **Audio:** Howler.js 2.2
- **Deployment:** Docker + docker-compose, single container on port 8780

## Architecture

The system has two main parts connected by WebSocket:

**Server (`server/`)** — Node.js process that watches Claude Code JSONL session files, strips sensitive data (code, file paths to basenames, bash commands to descriptions), and broadcasts normalized `PixelEvent` objects to browsers.
- `bridge/` — Core modules extracted from pixelhq-bridge (MIT): watcher, parser, claude-adapter, events, types
- `session-manager.ts` — Discovers active sessions, assigns agent IDs, tracks agent lifecycle state machine
- `ws-server.ts` — WebSocket broadcast to all connected browsers
- `hook-receiver.ts` — POST /api/hooks endpoint for Claude Code hooks
- `webhook-receiver.ts` — POST /api/webhooks endpoint for external sources (CI, Codex, etc.)
- `stats-store.ts` — Persistent session statistics (JSON file, survives restarts)

**Client (`src/`)** — React app with PixiJS canvas overlay:
- `engine/` — PixiJS rendering: tilemap (20x15 grid, 16px tiles), agent sprites, A* pathfinding, animation controller, station manager, ambient effects
- `state/` — Zustand stores: office (agents/stations), events (activity feed), audio, websocket connection
- `ui/` — React HUD overlay: header, agent roster sidebar, activity feed ticker, connection status, controls
- `audio/` — Howler.js wrapper and sound registry

**Data flow (two paths, merged in session-manager):**
1. **JSONL watching (always-on, zero-config):** Claude Code writes JSONL → chokidar detects → parser extracts → adapter strips sensitive data → event factory normalizes → session manager tags with agentId → WebSocket broadcasts → Zustand store updates → animation controller maps state to behavior → PixiJS renders.
2. **Claude Code hooks (opt-in, v2-M6):** Hook fires → async script POSTs to `/api/hooks` → session-manager merges with JSONL stream → same downstream path. Fills accuracy gaps: instant "waiting for human" (replaces 8s heuristic), deterministic parent-child linking (replaces 10s spawn window), new states like "needs approval" and "compacting."

**Event-to-behavior mapping** drives the entire visualization: each bridge event type (session.started, tool.file_write, activity.thinking, etc.) maps to an agent state, office location, and animation. See VISION.md for the full mapping table.

## Project Status

Milestones v1 (M1-M5) and v2 (M1-M6) are complete. Currently in v2-M7 (Stabilization & Polish). See VISION.md for the full roadmap.

## Key Design Decisions

- **Privacy first:** The claude-adapter must strip all sensitive content (code, full file paths, bash commands, thinking/responses) before broadcasting
- **Bridge extraction:** Core file-watching modules come from pixelhq-bridge (MIT) — extract only watcher, parser, adapter, events (~4 files), skip iOS-specific code
- **Single container:** Both static frontend and WebSocket server run in one Docker container
- **Sprites:** Clawdachi GIF blob via @pixi/gif (clone-per-agent), with 32x32folk.png fallback
- **Desk assignment:** First-come-first-served (FIFO), dynamic count from map config (16 main + 1 supervisor with Tiled map)
- **No socket.io:** Uses native WebSocket client + ws server to avoid overhead
