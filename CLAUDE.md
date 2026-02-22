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
- `ws-server.ts` — WebSocket broadcast to all connected browsers, with auth + connection limits
- `hook-receiver.ts` — POST /api/hooks endpoint for Claude Code hooks
- `webhook-receiver.ts` — POST /api/webhooks endpoint for external sources (CI, Codex, etc.)
- `stats-store.ts` — Persistent session statistics (JSON file, survives restarts)
- `sanitize.ts` — Input validation utilities (safeString, safeUrl, safeEnum) for webhook/hook payloads
- `rate-limit.ts` — In-memory sliding-window rate limiter (no external dependencies)

**Client (`src/`)** — React app with PixiJS canvas overlay:
- `engine/` — PixiJS rendering: tilemap (20x15 grid, 16px tiles), agent sprites, A* pathfinding, animation controller, station manager, ambient effects
- `state/` — Zustand stores: office (agents/stations), events (activity feed), audio, websocket connection
- `ui/` — React HUD overlay: header, agent roster sidebar, activity feed ticker, connection status, controls
- `audio/` — Howler.js wrapper and sound registry

**Data flow (two paths, merged in session-manager):**
1. **JSONL watching (always-on, zero-config):** Claude Code writes JSONL → chokidar detects → parser extracts → adapter strips sensitive data → event factory normalizes → session manager tags with agentId → WebSocket broadcasts → Zustand store updates → animation controller maps state to behavior → PixiJS renders.
2. **Claude Code hooks (opt-in, v2-M6):** Hook fires → async script POSTs to `/api/hooks` → session-manager merges with JSONL stream → same downstream path. Fills accuracy gaps: instant "waiting for human" (replaces 8s heuristic), deterministic parent-child linking, new states like "needs approval" and "compacting."

**Subagent parent linking** uses a priority chain: (1) hooks (`SubagentStart`) — most reliable, (2) file-path extraction — subagent JSONL paths embed the parent UUID (`<project>/<parent-uuid>/subagents/<child>.jsonl`), (3) time-window heuristic — 10s after parent's `Task` tool use (last resort).

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

## Git & Publishing Workflow

Two remotes, one branch:

- **`origin`** (Gitea) — primary remote, pushed during normal development
- **`github`** (GitHub) — public remote, pushed when ready to release

**Day-to-day:** Work on `main`, push to Gitea (`git push origin main`).

**Publishing to GitHub:** When ready for a public release:
```bash
git tag v1.x
git push origin v1.x
git push github main --tags
```

Both remotes share the same `main` branch and full history. Tags mark release points.

## Security (v2-M8)

- **Authentication:** Set `JOBS_TOKEN` env var to enable shared-token auth for WebSocket and `/api/hooks`. Token is auto-injected into the HTML page via `<meta>` tag; browser clients read it automatically. If unset, auth is disabled (zero-config default).
- **Input sanitization:** All webhook/hook payloads validated through `server/sanitize.ts` (safeString, safeUrl, safeEnum). URLs must be http/https — `javascript:` and `data:` protocols are rejected server-side and client-side.
- **Rate limiting:** API routes limited to 120 req/min/IP, healthz to 30 req/min/IP. In-memory sliding window, no external dependencies.
- **WebSocket limits:** `WS_MAX_CLIENTS` (default 50) global cap, `WS_MAX_PER_IP` (default 10) per-IP cap.
- **CSP headers:** Strict Content-Security-Policy, X-Frame-Options DENY, nosniff, Permissions-Policy.
- **Docker:** Non-root user (`jobs`), read-only filesystem, `cap_drop: ALL`, `no-new-privileges`, resource limits (512MB/1CPU).
