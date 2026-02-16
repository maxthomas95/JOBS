# J.O.B.S. — Jarvis Operations & Bot Surveillance

A self-hosted, browser-based pixel-art office that visualizes Claude Code agent activity in real-time. Each active coding session spawns a character who moves between stations — coding at a desk, thinking at a whiteboard, running commands at a terminal, searching at a library, grabbing coffee on a break.

Multiple simultaneous sessions = a bustling office.

Part of the [Jarvis](https://github.com/maxthomas) AI assistant ecosystem.

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

**Privacy first:** No code, file contents, or full paths ever leave the server. Both paths strip sensitive data — the JSONL adapter allowlists safe metadata, and the hook script forwards only event metadata.

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

## Enhanced Mode Setup

Enhanced mode is optional. JOBS works fully without it — hooks just make it more accurate.

**Automatic setup:**

```bash
node server/setup-hooks.js
```

This adds async hooks to your `~/.claude/settings.json` that POST event metadata to the JOBS server. No sensitive data is sent.

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
