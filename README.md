# J.O.B.S. — Jarvis Operations & Bot Surveillance

[![CI](https://github.com/maxthomas95/JOBS/actions/workflows/ci.yml/badge.svg)](https://github.com/maxthomas95/JOBS/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![J.O.B.S. Office](jarvis.png)

A self-hosted pixel-art office for Claude Code and Codex activity, with a readable session rail, live office, inspector, and activity feed. Each active coding session spawns a character who moves between stations — coding at a desk, thinking at a whiteboard, running commands at a terminal, searching at a library, grabbing coffee on a break.

Multiple simultaneous sessions = a bustling office. Perfect for developers running multiple Claude Code sessions, team leads monitoring sub-agent trees, or anyone who wants a living dashboard of their AI workforce.

Part of the [Jarvis](https://github.com/maxthomas95/homelab-jarvis) AI assistant ecosystem.

## Features

- **Live agent visualization** — sprites walk between office stations based on real Claude Code activity
- **Speech bubbles** — thought clouds, tool indicators, and file names above each agent
- **Supervisor mode** — parent agents patrol sub-agent desks, delegate work, and check in
- **Agent detail panel** — click any agent for a dossier: project, tools used, state timeline, team relationships
- **Follow mode** — zoom in and track a single agent with smooth camera following
- **Day/night cycle** — office lighting shifts based on real time of day
- **Themes** — dark (default), bright, cyberpunk (neon glow), retro (CRT scanlines)
- **Tiled map support** — renders Tiled Map Editor `.tmj` files directly, with procedural fallback
- **Ambient audio** — keyboard clacking, coffee brewing, office hum, retro chimes (14 real .ogg samples)
- **Stats dashboard** — sessions today, total hours, files touched, tools used breakdown
- **Webhook adapter** — accept events from any source (CI, deploy, monitoring) via HTTP POST
- **Multi-instance** — watch multiple machines' Claude dirs, with machine grouping in the HUD
- **Codex lifecycle hooks** — live tool categories, approval/waiting states, compaction, and subagents; legacy notify remains completion-only. [Setup and limits](docs/codex.md)
- **Modern monitoring controls** — search and provider/state/attention filters, keyboard selection, responsive inspector, pauseable activity, settings, and kiosk mode
- **Reduced motion** — respects the system preference in the controls and pixel renderer, with an explicit setting
- **Metadata-only agent adapters** — transcripts, prompts, responses, commands, search patterns, and full paths stay out of browser events; generic webhook display labels remain caller-supplied

## How It Works

Claude Code has two complementary data paths. Codex uses its own supported lifecycle hooks; it does not depend on parsing Codex transcripts.

### Standard Mode (zero config, works out of the box)

```
Claude Code writes JSONL  →  chokidar detects  →  parser extracts
→  adapter strips sensitive data  →  WebSocket broadcasts
→  Zustand updates  →  PixiJS renders
```

The server watches `~/.claude/projects/**/*.jsonl` for Claude Code session files. Each JSONL line is parsed, stripped of sensitive content (code, file paths, bash commands), and broadcast as a normalized event to all connected browsers. The client maps events to agent states and office locations, driving sprite movement and animation.

### Enhanced Mode (opt-in, via Claude Code hooks)

```
Claude Code hook fires  →  async script POSTs to JOBS server
→  session-manager merges with JSONL data  →  richer, faster updates
```

Claude Code's [hooks system](https://docs.anthropic.com/en/docs/claude-code/hooks) can send events directly to the JOBS server, filling gaps that JSONL file watching can't cover:

- **Instant "waiting for human" detection** — the `Stop` hook fires the moment Claude finishes, replacing an 8-second silence heuristic
- **Deterministic parent-child linking** — `SubagentStart`/`SubagentStop` hooks link teams immediately. Without hooks, subagent JSONL file paths (which embed the parent session UUID) provide reliable linking; the 10-second timing heuristic is now a last-resort fallback
- **"Needs Approval" state** — `Notification` hooks surface permission prompts as a visible agent state (currently invisible via JSONL)
- **Context compaction awareness** — `PreCompact` hook shows when an agent is compressing its memory

Claude delivery runs asynchronously with a bounded timeout. Codex has event-specific timing requirements, documented in [Codex setup](docs/codex.md). Monitoring scripts emit no approval decisions.

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/maxthomas95/JOBS.git && cd JOBS
docker compose up -d
```

Open `http://localhost:8780`. The container mounts your home `.claude` directory read-only and publishes only to loopback by default. Set `CLAUDE_DATA_DIR` for a different host directory. The runtime image excludes development dependencies.

### Local Development

```bash
npm ci
npm run dev
```

This starts both the Vite dev server (port 5173) and the backend (port 8780) via `concurrently`.

To see activity without real Claude Code sessions:

```bash
MOCK_EVENTS=true npm run dev:server
```

Use `MOCK_EVENTS=supervisor` to test team/supervisor scenarios.

### Production Build

```bash
npm run build
npm start
```

## Configuration

All variables are optional. Copy `.env.example` to `.env` to customize.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8780` | Server port |
| `HOST` | `127.0.0.1` | Local server bind address; container uses `0.0.0.0` internally |
| `ALLOWED_HOSTS` | _(loopback only)_ | Additional browser/proxy hostnames or IPs, comma-separated, without scheme or port |
| `JOBS_BIND_ADDRESS` | `127.0.0.1` | Docker host publish address |
| `CLAUDE_DATA_DIR` | _(home)/.claude_ | Docker host transcript directory |
| `CLAUDE_DIR` | `~/.claude` | Path to Claude Code data directory |
| `WS_PATH` | `/ws` | WebSocket endpoint path |
| `MOCK_EVENTS` | `false` | Generate labeled demo events (`true`, `supervisor`, `webhook`, `multi`) |
| `STALE_IDLE_MS` | `300000` | Mark agent idle after this silence (ms) |
| `STALE_EVICT_MS` | `900000` | Remove stale agent after this silence (ms) |
| `MACHINE_ID` | _(auto)_ | Unique ID for this machine (multi-instance) |
| `MACHINE_NAME` | _(hostname)_ | Display name for this machine in the HUD |
| `WEBHOOK_TOKEN` | _(inherits JOBS_TOKEN)_ | Optional separate generic webhook credential |
| `JOBS_TOKEN` | _(none)_ | Browser sign-in, WebSocket/stats/diagnostics access, and bearer auth for Claude/Codex ingestion |
| `COOKIE_SECURE` | `false` | Set `true` when serving through an HTTPS reverse proxy |
| `WS_MAX_CLIENTS` | `50` | Maximum total WebSocket connections |
| `WS_MAX_PER_IP` | `10` | Maximum WebSocket connections per IP |
| `JOBS_URL` | `http://localhost:8780` | JOBS server URL (used by remote hook scripts) |

## Enhanced Mode Setup

Enhanced mode is optional. JOBS works fully without it — hooks just make it more accurate.

**Automatic setup:**

```bash
node server/setup-hooks.js
```

This adds async hooks to your `~/.claude/settings.json` that POST event metadata to the JOBS server. No sensitive data is sent.

Use `--dry-run` to inspect changes and `--remove` to remove JOBS handlers.
The installer backs up changed files and preserves unrelated handlers. Tests
use `--claude-home` / `--codex-home` to avoid touching real configuration.

For Codex support:

```bash
node server/setup-hooks.js --codex
node server/setup-hooks.js --codex --check
```

Use the installer for the platform-specific command and metadata allowlist.
Restart the coding agent after installation and review hook trust when prompted.
Codex setup preserves `config.toml` and existing notify commands; see
[Codex installation and diagnostics](docs/codex.md) for details.

**What improves with hooks enabled:**

| Without Hooks | With Hooks |
|---|---|
| "Waiting for human" detected after ~8s silence | Instant detection via `Stop` event |
| Parent-child linking uses 10s timing window | Deterministic via `SubagentStart` |
| Permission prompts invisible | "Needs Approval" agent state |
| Context compaction invisible | "Compacting..." agent state |

## Webhooks

Any external system can send events to JOBS via `POST /api/webhooks`:

```bash
curl -X POST http://localhost:8780/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{"source_id": "ci-main", "event": "build", "state": "running", "activity": "Running tests"}'
```

Webhook agents appear as full office citizens with desks, pathfinding, and bubbles. Include `Authorization: Bearer <token>` when `WEBHOOK_TOKEN` or `JOBS_TOKEN` is set. Generic `activity`, `source_name`, and URLs are intentionally displayed: send only public labels and links. Codex adapters use fixed activity labels and ignore response text.

## Security

Local startup binds to loopback. For network access, configure authentication, a trusted hostname, and your HTTPS reverse proxy before exposing the port.

**Authentication:** Set `JOBS_TOKEN` in `.env`. Enter it on the browser sign-in page; the server creates a revocable, HttpOnly, SameSite=Strict cookie valid for 24 hours. Tokens are never embedded in HTML, browser storage, or WebSocket URLs. Signing out revokes the session; a server restart requires signing in again.

- Stats, provider diagnostics, and WebSocket connections require viewer authentication.
- `/api/hooks`, `/api/codex/hooks`, and `/api/codex/notify` require `Authorization: Bearer <JOBS_TOKEN>`.
- `/api/webhooks` uses `WEBHOOK_TOKEN` when configured, otherwise `JOBS_TOKEN`.
- Set sender environment variables `JOBS_URL` and `JOBS_TOKEN` for hook delivery. Browser sign-in does not configure hook credentials.
- Host and Origin checks reject unexpected browser origins and DNS rebinding. Add network hostnames to `ALLOWED_HOSTS` and preserve Host/Origin through the proxy. Set `COOKIE_SECURE=true` for HTTPS proxy deployments.

**Service identity:** `GET /healthz` returns `{ ok, app: "jobs", version }` so integrations (e.g. Tether) can positively identify a running JOBS instance.

Without `JOBS_TOKEN`, allowed local clients have access without sign-in. Explicitly allowing a network hostname does not enable authentication; configure both for network deployment.

**Input validation:** All webhook and hook payloads are sanitized through `server/sanitize.ts`. URLs are validated as http/https only — `javascript:` and `data:` protocols are rejected both server-side and client-side.

**Rate limiting:** API routes allow 1,200 requests/minute/IP for busy hook streams, with 10 sign-in attempts/minute/IP. WebSocket connections are capped at 50 total (`WS_MAX_CLIENTS`) and 10 per IP (`WS_MAX_PER_IP`).

**Docker hardening:** The container runs as a non-root user (`jobs`), with a read-only filesystem, all capabilities dropped, `no-new-privileges`, and resource limits (512MB RAM, 1 CPU). Stats persist via a named volume.

**Security headers:** CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy.

## Event-to-Behavior Mapping

| Event | State | Location |
|---|---|---|
| `session.started` | entering | Door → desk |
| `activity.thinking` | thinking | Whiteboard |
| `activity.responding` | coding | Desk |
| `tool.Read/Write/Edit` | coding/reading | Desk |
| `tool.Bash` | terminal | Terminal station |
| `tool.Grep/Glob/WebSearch` | searching | Library |
| `tool.Task` | delegating | Desk (sub-agent spawns) |
| `summary` | cooling | Coffee machine |
| `activity.waiting` | waiting | Coffee machine |
| `agent.error` | error | Current location (red flash) |
| `session.ended` | leaving | → Door (despawn) |

## Tech Stack

- **Frontend:** React 19 + TypeScript + PixiJS 8 (imperative) + Zustand 5
- **Backend:** Node.js + Express + ws
- **Build:** Vite 6
- **File Watching:** chokidar 5
- **Pathfinding:** pathfinding (A* grid)
- **Audio:** Howler.js 2.2
- **Deployment:** Docker, single container, port 8780

## Project Structure

```
server/                 Node.js backend
  bridge/               Extracted from pixelhq-bridge (MIT)
    watcher.ts          chokidar file watcher
    parser.ts           JSONL line parser
    claude-adapter.ts   Privacy-stripping adapter
    pixel-events.ts     Event factories
    types.ts            Shared bridge types
  session-manager.ts    Agent lifecycle + desk assignment
  ws-server.ts          WebSocket broadcast + auth + connection limits
  hook-receiver.ts      POST /api/hooks endpoint
  webhook-receiver.ts   POST /api/webhooks endpoint
  stats-store.ts        Persistent session statistics
  sanitize.ts           Input validation (safeString, safeUrl, safeEnum)
  rate-limit.ts         In-memory rate limiter middleware
  mock-events.ts        Fake event generator for testing
  setup-hooks.js        One-command hooks + Codex setup
  hooks/                Hook notify scripts
    jobs-notify.sh      Shell script for Claude Code hooks
    jobs-notify.js      Node.js alternative
    codex-notify.js     OpenAI Codex notify hook

src/                    React frontend
  engine/               PixiJS rendering
    PixelOffice.tsx     Canvas setup + station config
    AgentSprite.ts      Character sprites + supervisor behavior
    Pathfinder.ts       A* grid pathfinding
    AnimationController.ts  State → animation mapping
    AmbientEffects.ts   Desk glow, wall clock, coffee steam
    DayNightCycle.ts    Time-of-day lighting
    FollowMode.ts       Single-agent camera tracking
    tileset/            Tilemap rendering (6 files)
      TiledMapRenderer.ts   Renders Tiled .tmj maps directly
      ImageTilesetRenderer.ts   LimeZu sprite sheet renderer
      ProceduralTilesetRenderer.ts  Code-drawn fallback
      MapConfig.ts      JSON map configuration
  state/                Zustand stores
    useOfficeStore.ts   Agents, stations, follow mode
    useEventStore.ts    Activity feed / event log
    useAudioStore.ts    Audio preferences + playback
    useConnectionStore.ts  WebSocket connection state
    useDayNightStore.ts Day/night cycle state
    useThemeStore.ts    Theme selection
    useStatsStore.ts    Session statistics
  hooks/
    useWebSocket.ts     WebSocket connection hook
  ui/                   React HUD overlay
    HUD.tsx             Header, roster, feed, controls
    BubbleOverlay.tsx   Speech/thought bubbles above sprites
    AgentDetailPanel.tsx  Agent dossier (click to inspect)
    StatsPanel.tsx      Session statistics dashboard
    ConnectionStatus.tsx  WebSocket health indicator
  audio/                Sound management
    AudioManager.ts     Howler.js wrapper
    sounds.ts           Sound registry + volume config
  themes.ts             Theme definitions (dark, bright, cyberpunk, retro)
  types/                Shared TypeScript types
  assets/
    sprites/            Clawdachi GIF + character data
    audio/              14 .ogg samples (CC0)
```

## Tilesets & Custom Maps

### How rendering works

J.O.B.S. uses a detailed map when licensed images are available:

1. **Tiled map + tileset images** — if a `.tmj` map and matching PNG sprite sheets are present, the [Tiled Map Editor](https://www.mapeditor.org/) layout renders directly with full detail
2. **Procedural fallback** — if images are missing or cannot load, the office renders as colored rectangles with the same shared layout and desk positions

The procedural fallback ships by default and works out of the box — no assets to buy, no setup required. Agents, pathfinding, desk assignment, and all features work identically regardless of which renderer is active.

### Adding the LimeZu tileset

For detailed pixel art, you can add the [LimeZu Modern Office](https://limezu.itch.io/modernoffice) tileset ($2.50):

1. Buy and download the tileset from itch.io
2. Drop the PNG files into `src/assets/tiles/`:
   - `Room_Builder_Office_16x16.png`
   - `Modern_Office_16x16.png`
3. Restart the dev server — the app auto-detects the images and switches renderers

The tileset images are gitignored and never committed to the repo.

**Syncing purchased tiles across your own machines:** the license forbids redistributing the assets, so keep them in a *private* GitHub repo and run `npm run assets` (requires an authenticated [GitHub CLI](https://cli.github.com/)) to pull them into `src/assets/tiles/` on each machine. Set `JOBS_ASSETS_REPO=owner/name` to point at your own private repo. Remember to `npm run build` afterward so production builds include them.

### Using your own tileset

You can build a completely custom office layout with [Tiled Map Editor](https://www.mapeditor.org/):

1. Create a `.tmj` map (16x16 tile size, 20x15 grid) with your own tileset PNGs
2. Place the tileset PNGs in `src/assets/tiles/`
3. Replace the map data in `src/assets/maps/office-tiled.json` with your exported `.tmj`
4. Update the shared station positions and access lanes in `src/types/office-layout.ts`, used by both server allocation and rendering:
   - `door` — where agents enter/exit
   - `desks` — array of `{x, y}` grid positions for agent workstations
   - `whiteboard`, `terminal`, `library`, `coffee` — shared stations

The built-in layout has 16 regular desks and one supervisor desk. Changes to the map should preserve reachability from the door to every station; `tests/lifecycle-layout.test.ts` checks both renderers.

## Screenshots

| Busy Office | Full House |
|---|---|
| ![Busy Office](preview-4.png) | ![Full House](preview-5.png) |

| HUD & Roster | Agent Sprites |
|---|---|
| ![HUD](preview-2.png) | ![Sprites](preview-3.png) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

## Roadmap

The full design document lives in [VISION.md](VISION.md). Here's what's ahead.

### Planned Features

Concrete, scoped features planned for future releases:

- **Sound customization** — per-sound volume sliders and sound packs beyond the current settings
- **Open-source tileset upgrade** — replace procedural colored rectangles with detailed code-drawn pixel art (zero external assets, zero licensing concerns)
- **Demo mode** — `?demo=true` URL param or HUD button to showcase the office without real Claude sessions, with auto-demo on idle for public-facing instances
- **Kiosk enhancements** — auto-rotate agent focus and auto-hide the cursor beyond the current office-focused mode

### Moonshots

Big, ambitious features — each would be a marquee addition:

- **Live terminal view** — click a sprite, see its live Claude Code session via xterm.js
- **Clawdachi sprite system** — expressive, state-aware blob characters with per-state particle effects, facial expressions, and personality palettes
- **Live room editor** — WYSIWYG drag-and-drop furniture placement with dynamic pathfinding rebuild
- **Time-lapse replay** — record every event, replay an entire day at high speed with a visual timeline
- **Multi-tool agent adapters** — purpose-built watchers for Cursor, Windsurf, Aider alongside Claude Code and Codex
- **Spectator mode** — shareable, read-only links so teammates can watch your office from anywhere
- **Agent personality system** — persistent traits (speed, anxiety, sociability) that make each agent feel like an individual
- **AI-generated floor plans** — describe your office in natural language, get a valid map layout
- **Outbound notifications** — push alerts to Slack, Discord, or any webhook when agents need attention

### The Whiteboard

Ideas that are scoped and ready to build, waiting for community interest or a rainy weekend:

- **Sound packs** — swap between audio themes (office, retro-arcade, nature) or drop in your own
- **Keyboard shortcuts** — full keyboard control (M mute, T theme, Tab cycle agents, ? help overlay)
- **Stats export** — CSV and JSON export of session history with date range filtering

## License

[MIT](LICENSE)
