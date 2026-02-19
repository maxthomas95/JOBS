# J.O.B.S. — Jarvis Operations & Bot Surveillance

A self-hosted, browser-based pixel-art office that visualizes Claude Code agent activity in real-time. Each active coding session spawns a character who moves between stations — coding at a desk, thinking at a whiteboard, running commands at a terminal, searching at a library, grabbing coffee on a break.

Multiple simultaneous sessions = a bustling office.

Part of the [Jarvis](https://github.com/maxthomas) AI assistant ecosystem.

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
- **OpenAI Codex support** — visualize Codex CLI sessions alongside Claude Code
- **Privacy first** — no code, file contents, or full paths ever leave the server

## How It Works

J.O.B.S. has two data paths — both work independently, and they're better together.

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
- **Deterministic parent-child linking** — `SubagentStart`/`SubagentStop` hooks link teams immediately, replacing a 10-second timing window
- **"Needs Approval" state** — `Notification` hooks surface permission prompts as a visible agent state (currently invisible via JSONL)
- **Context compaction awareness** — `PreCompact` hook shows when an agent is compressing its memory

All hooks run as `async: true` so they never slow down Claude's work. See [Enhanced Mode Setup](#enhanced-mode-setup) below.

## Quick Start

### Docker (recommended)

```bash
git clone <repo-url> && cd jobs
docker compose up -d
```

Open `http://localhost:8780`. The container mounts `~/.claude` read-only.

### Local Development

```bash
npm install
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
| `CLAUDE_DIR` | `~/.claude` | Path to Claude Code data directory |
| `WS_PATH` | `/ws` | WebSocket endpoint path |
| `MOCK_EVENTS` | `false` | Generate fake events (`true`, `supervisor`) |
| `STALE_IDLE_MS` | `300000` | Mark agent idle after this silence (ms) |
| `STALE_EVICT_MS` | `900000` | Remove stale agent after this silence (ms) |
| `MACHINE_ID` | _(auto)_ | Unique ID for this machine (multi-instance) |
| `MACHINE_NAME` | _(hostname)_ | Display name for this machine in the HUD |
| `WEBHOOK_TOKEN` | _(none)_ | If set, `POST /api/webhooks` requires Bearer auth |
| `JOBS_URL` | `http://localhost:8780` | JOBS server URL (used by remote hook scripts) |

## Enhanced Mode Setup

Enhanced mode is optional. JOBS works fully without it — hooks just make it more accurate.

**Automatic setup:**

```bash
node server/setup-hooks.js
```

This adds async hooks to your `~/.claude/settings.json` that POST event metadata to the JOBS server. No sensitive data is sent.

For Codex support:

```bash
node server/setup-hooks.js --codex
```

**Manual setup:** Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": ".claude/hooks/jobs-notify.sh", "async": true }] }],
    "SubagentStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": ".claude/hooks/jobs-notify.sh", "async": true }] }],
    "SubagentStop": [{ "matcher": "", "hooks": [{ "type": "command", "command": ".claude/hooks/jobs-notify.sh", "async": true }] }],
    "Notification": [{ "matcher": "permission_prompt", "hooks": [{ "type": "command", "command": ".claude/hooks/jobs-notify.sh", "async": true }] }]
  }
}
```

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

Webhook agents appear as full office citizens with desks, pathfinding, and bubbles. If `WEBHOOK_TOKEN` is set, include `Authorization: Bearer <token>` or a `token` field in the body.

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
  ws-server.ts          WebSocket broadcast
  hook-receiver.ts      POST /api/hooks endpoint
  webhook-receiver.ts   POST /api/webhooks endpoint
  stats-store.ts        Persistent session statistics
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

## License

MIT
