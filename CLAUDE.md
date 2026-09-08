# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Shared working guidance is also available in [AGENTS.md](AGENTS.md), with scoped
guidance under `server/` and `src/`. See the [September 2026 review](docs/reviews/2026-09-07.md)
for the original findings. [Implementation tracking](docs/IMPLEMENTATION.md)
records the resulting fixes and validation; [Codex setup](docs/codex.md) describes
the lifecycle integration. AGENTS.md contains the current verification commands.

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

**Server (`server/`)** — Node.js process that watches Claude Code JSONL session files, strips sensitive data (file paths to basenames, shell/search work to fixed labels), and broadcasts normalized `PixelEvent` objects to browsers. Codex has a separate metadata-only lifecycle hook adapter.
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

VISION.md marks v1 (M1-M5) and v2 (M1-M8) implemented. The September modernization
adds authenticated viewing, lifecycle fixes, Codex hooks, and the modern office
shell. See docs/IMPLEMENTATION.md for validation and remaining limitations.

## Key Design Decisions

- **Privacy first:** The claude-adapter must strip all sensitive content (code, full file paths, bash commands, thinking/responses) before broadcasting
- **Bridge extraction:** Core file-watching modules come from pixelhq-bridge (MIT) — extract only watcher, parser, adapter, events (~4 files), skip iOS-specific code
- **Single container:** Both static frontend and WebSocket server run in one Docker container
- **Sprites:** Clawdachi GIF blob via @pixi/gif (clone-per-agent), with 32x32folk.png fallback. OpenClaw and Codex agents get dedicated mascot textures, selected per-agent in `AgentSprite.ts` (Codex: `provider === 'codex'`)
- **Desk assignment:** First-come-first-served (FIFO), dynamic count from map config (16 main + 1 supervisor with Tiled map)
- **No socket.io:** Uses native WebSocket client + ws server to avoid overhead

## Git & Publishing Workflow

**GitHub is the single source of truth** — one remote (`github` → `maxthomas95/JOBS`), one long-lived branch (`main`). The old Gitea remote is retired.

**`main` is protected** — never commit or push directly to it. All changes go through branch + PR + squash merge (linear history; CI checks `lint`, `build`, and `npm audit` must pass).

### Worktree and branch policy

- **Never work directly on `main`** — always create a feature branch (e.g. `feat/follow-mode`, `fix/desk-assignment`, `docs/readme-polish`).
- **Prefer separate worktrees** (`git worktree add`) for substantial tasks — multiple agent sessions may be active simultaneously.
- **Stage only relevant files** — do not disturb unrelated uncommitted changes.

### PR process

1. **Branch:** create a feature branch from `main`.
2. **Push:** `git push github HEAD:refs/heads/<branch-name>`.
3. **Create PR:** against `main` with a body containing:
   - `## Summary` — user-visible behavior and any privacy/security boundary impacts.
   - `## Test plan` — checkboxes with commands actually run.
   - `## Out of scope` — deliberately deferred follow-up work.
4. **Squash merge:** use explicit `--subject` and `--body` to produce a single clean commit.

### Commit messages

Conventional commit prefixes for subject lines: `feat:`, `fix(scope):`, `docs:`, `chore:`, etc. Keep subjects to one line; write a detailed body covering what changed and why.

### Releases

```bash
git tag v1.x
git push github v1.x
```

Tags mark release points.

## Security (v2-M8)

- **Authentication:** `JOBS_TOKEN` enables browser sign-in using a revocable HttpOnly cookie and bearer auth for ingestion. Stats/diagnostics/WebSocket are protected. Tokens never go in HTML, browser storage, or URLs. `ALLOWED_HOSTS` permits explicit network hosts; default access is loopback.
- **Input sanitization:** All webhook/hook payloads validated through `server/sanitize.ts` (safeString, safeUrl, safeEnum). URLs must be http/https — `javascript:` and `data:` protocols are rejected server-side and client-side.
- **Rate limiting:** API routes allow 1,200 req/min/IP, sign-in 10/min/IP, healthz 30/min/IP. In-memory sliding window, no external dependencies.
- **WebSocket limits:** `WS_MAX_CLIENTS` (default 50) global cap, `WS_MAX_PER_IP` (default 10) per-IP cap.
- **CSP headers:** Strict Content-Security-Policy, X-Frame-Options DENY, nosniff, Permissions-Policy.
- **Docker:** Non-root user (`jobs`), read-only filesystem, `cap_drop: ALL`, `no-new-privileges`, resource limits (512MB/1CPU).
