# J.O.B.S. — Jarvis Operations & Bot Surveillance

A self-hosted, browser-based pixel-art office that visualizes Claude Code agent activity in real-time. Each active coding session spawns a character who moves between stations — coding at a desk, thinking at a whiteboard, running commands at a terminal, searching at a library, grabbing coffee on a break.

Multiple simultaneous sessions = a bustling office.

Part of the [Jarvis](https://github.com/maxthomas) AI assistant ecosystem.

## How It Works

```
Claude Code writes JSONL  →  chokidar detects  →  parser extracts
→  adapter strips sensitive data  →  WebSocket broadcasts
→  Zustand updates  →  PixiJS renders
```

The server watches `~/.claude/projects/**/*.jsonl` for Claude Code session files. Each JSONL line is parsed, stripped of sensitive content (code, file paths, bash commands), and broadcast as a normalized event to all connected browsers. The client maps events to agent states and office locations, driving sprite movement and animation.

**Privacy first:** No code, file contents, or full paths ever leave the server. The adapter allowlists only safe metadata (basenames, tool names, patterns).

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

### Production Build

```bash
npm run build
npm start
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8780` | Server port |
| `CLAUDE_DIR` | `~/.claude` | Path to Claude Code data directory |
| `MOCK_EVENTS` | `false` | Generate fake events for testing |

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
- **Deployment:** Docker, single container, port 8780

## Project Structure

```
server/               Node.js backend
  bridge/             Extracted from pixelhq-bridge (MIT)
    watcher.ts        chokidar file watcher
    parser.ts         JSONL line parser
    claude-adapter.ts Privacy-stripping adapter
    pixel-events.ts   Event factories
    types.ts          Shared bridge types
  session-manager.ts  Agent lifecycle + desk assignment
  ws-server.ts        WebSocket broadcast
  mock-events.ts      Fake event generator for testing

src/                  React frontend
  engine/             PixiJS rendering
    PixelOffice.tsx   Canvas setup
    TileMap.ts        Office layout (20x15 grid)
    AgentSprite.ts    Character sprites + animation
    Pathfinder.ts     A* grid pathfinding
    AnimationController.ts  State → sprite bridge
  state/              Zustand stores
  ui/                 React HUD overlay
  types/              Shared TypeScript types
  assets/sprites/     ai-town character spritesheets
```

## License

MIT
