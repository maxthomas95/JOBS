# J.O.B.S. — Jarvis Operations & Bot Surveillance

### Architecture & Project Plan

**Version:** 0.1.0  
**Date:** February 8, 2026  
**Author:** Max Thomas

---

## Vision

J.O.B.S. is a self-hosted, browser-based pixel-art office that comes alive as Claude Code agents work in real-time. Each active coding session spawns a character who moves between stations — coding at a desk, thinking at a whiteboard, running commands at a terminal, searching at a library, idling at the coffee machine. Multiple simultaneous sessions = a bustling office.

Part of the Jarvis AI assistant ecosystem.

---

## Decisions Locked In

| Decision | Choice | Rationale |
|---|---|---|
| **Name** | J.O.B.S. (Jarvis Operations & Bot Surveillance) | MCU-inspired, describes the app, fits Jarvis ecosystem |
| **Agent Source (v1)** | Claude Code sessions | Via extracted pixelhq-bridge core modules |
| **Deployment** | Self-hosted Docker on Proxmox | docker-compose, single `docker compose up` |
| **Priority Order** | 1. Live data mapping → 2. Multi-agent → 3. Visuals → 4. Customization | Function over form |
| **Sprites (v1)** | a16z/ai-town MIT sprites (8 characters w/ walk cycles) | Free, already TypeScript-defined, swap later |
| **Sprites (v1.5)** | LimeZu Modern Office tileset + PixelLab.ai custom characters | $2.50 tileset + AI-generated office workers |
| **Bridge Strategy** | Extract core modules (watcher, parser, adapter, events) | ~4 files, skip iOS-specific code (Bonjour, auth) |
| **Audio** | Yes — ambient office sounds + retro chimes | freesound.org CC0 + jsfxr |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Client                            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Pixel Engine  │  │  State Mgr   │  │   HUD Overlay     │  │
│  │ (PixiJS)      │  │ (Zustand)    │  │ (React)           │  │
│  │               │  │              │  │                    │  │
│  │ - Tilemap     │  │ - Agents[]   │  │ - J.O.B.S. ONLINE │  │
│  │ - Sprites     │  │ - Events[]   │  │ - Agent roster     │  │
│  │ - Pathfinding │  │ - Office     │  │ - Activity feed    │  │
│  │ - Animations  │  │ - Audio      │  │ - Controls         │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────┘  │
│         └────────┬────────┘                                   │
│           ┌──────┴───────┐                                    │
│           │  WS Client   │                                    │
│           └──────┬───────┘                                    │
└──────────────────┼────────────────────────────────────────────┘
                   │ WebSocket (ws://jobs:8765)
┌──────────────────┼────────────────────────────────────────────┐
│                  │       J.O.B.S. Server (Node.js)            │
│           ┌──────┴───────┐                                    │
│           │  WS Server   │  ← Browsers connect here          │
│           └──────┬───────┘                                    │
│                  │                                            │
│     ┌────────────┴────────────────┐                           │
│     │     Session Manager         │                           │
│     │  - Discovers active sessions│                           │
│     │  - Assigns agent IDs        │                           │
│     │  - Tracks lifecycle         │                           │
│     └────────────┬────────────────┘                           │
│                  │                                            │
│     ┌────────────┴────────────────┐                           │
│     │     Bridge Core             │                           │
│     │  (extracted from pixelhq)   │                           │
│     │  - Watcher (chokidar)       │                           │
│     │  - Parser (JSONL)           │                           │
│     │  - Claude Adapter (privacy) │                           │
│     │  - Event Factories          │                           │
│     └────────────┬────────────────┘                           │
│                  │                                            │
└──────────────────┼────────────────────────────────────────────┘
                   │ reads (chokidar file watch)
                   │
            ~/.claude/projects/**/*.jsonl
            (mounted read-only into container)
```

---

## Event Flow

### From Claude Code → Pixel Character

```
Claude Code writes to ~/.claude/projects/myapp/session.jsonl
    │
    ▼
Watcher detects new JSONL line (chokidar)
    │
    ▼
Parser extracts JSON, identifies event type
    │
    ▼
Claude Adapter strips all sensitive content
  - File paths → basename only ("auth.ts")
  - Code content → stripped entirely
  - Bash commands → description only
  - Thinking/responses → stripped
    │
    ▼
Event Factory produces normalized PixelEvent
  { type: "tool", tool: "file_write", context: "auth.ts", status: "started" }
    │
    ▼
Session Manager tags with agentId, updates agent state machine
    │
    ▼
WebSocket broadcasts to all connected browsers
    │
    ▼
Zustand store updates agent state
    │
    ▼
Animation Controller maps state → office behavior
  "file_write" + "started" → agent walks to desk → typing animation
    │
    ▼
PixiJS renders character movement + animation
```

### Event → Office Behavior Mapping

| Bridge Event | Agent State | Office Location | Animation |
|---|---|---|---|
| `session.started` | `entering` | Door → assigned desk | Walk in, sit down |
| `activity.thinking` | `thinking` | Whiteboard | Standing, scribbling |
| `activity.responding` | `coding` | Desk | Typing furiously |
| `tool.file_read` | `reading` | Desk | Reading, scrolling |
| `tool.file_write` | `coding` | Desk | Typing, screen flashing |
| `tool.terminal` | `terminal` | Terminal station | Standing, typing |
| `tool.search` | `searching` | Library/bookshelf | Browsing, pulling books |
| `tool.plan` | `planning` | Whiteboard | Drawing diagrams |
| `tool.spawn_agent` | `delegating` | Desk → door (new agent enters) | Pointing, new char spawns |
| `summary` (turn end) | `cooling` | Desk → coffee machine | Stretching, walking |
| `activity.waiting` | `idle` | Coffee machine / wandering | Sipping, looking around |
| `agent.error` | `error` | Current location | Error bubble, red flash |
| `session.ended` | `leaving` | Current → door | Pack up, walk out |

---

## Tech Stack

| Component | Technology | Version | Why |
|---|---|---|---|
| **Rendering** | PixiJS (imperative API) | v8 | Lightweight 2D WebGL, great sprite support |
| **UI** | React 19 + TypeScript | 19.x | HUD overlay, Zustand integration |
| **State** | Zustand | 5.x | Minimal boilerplate, perfect for real-time |
| **WebSocket** | Native WebSocket (client) / ws (server) | - | No socket.io overhead |
| **Bridge Core** | Extracted from pixelhq-bridge (MIT) | - | Battle-tested privacy stripping |
| **File Watching** | chokidar | 5.x | Directory watch with ignored filter |
| **Build** | Vite | 6.x | Fast, TypeScript-native |
| **Pathfinding** | pathfinding (npm) | 0.4.x | A* grid pathfinding |
| **Audio** | Howler.js | 2.2.x | Simple, reliable web audio |
| **Container** | Docker + docker-compose | - | Self-hosted on Proxmox |
| **Server** | Express (static) + ws | - | Serves frontend + WebSocket |

---

## Project Structure

```
jarvis-jobs/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── vite.config.ts
│
├── server/                          # Node.js backend
│   ├── index.ts                     # Entry: HTTP server + WS server
│   ├── ws-server.ts                 # WebSocket server (broadcasts to browsers)
│   ├── session-manager.ts           # Multi-session tracking + agent assignment
│   │
│   └── bridge/                      # Extracted from pixelhq-bridge (MIT)
│       ├── watcher.ts               # chokidar file watcher
│       ├── parser.ts                # JSONL line parser
│       ├── claude-adapter.ts        # Privacy-stripping adapter
│       ├── events.ts                # Event factories + privacy utils
│       └── types.ts                 # Event type definitions
│
├── src/                             # React frontend
│   ├── main.tsx                     # Entry point
│   ├── App.tsx                      # Root component
│   │
│   ├── engine/                      # PixiJS rendering
│   │   ├── PixelOffice.tsx          # Main canvas component (@pixi/react)
│   │   ├── TileMap.ts              # Office layout, tile rendering
│   │   ├── AgentSprite.ts          # Character sprite + animation
│   │   ├── Pathfinder.ts           # A* movement between stations
│   │   ├── AnimationController.ts  # AgentState → animation mapping
│   │   ├── StationManager.ts       # Station positions, assignment, queueing
│   │   └── AmbientEffects.ts       # Screen glow, steam, clock, etc.
│   │
│   ├── state/                       # Zustand stores
│   │   ├── useOfficeStore.ts        # Agents, stations, office state
│   │   ├── useEventStore.ts         # Activity feed / event log
│   │   ├── useAudioStore.ts         # Audio preferences + playback
│   │   └── useWebSocket.ts          # WS connection hook
│   │
│   ├── ui/                          # React HUD overlay
│   │   ├── HUD.tsx                  # J.O.B.S. ONLINE header + status
│   │   ├── AgentRoster.tsx          # Sidebar: active agents + status
│   │   ├── ActivityFeed.tsx         # Bottom ticker: real-time events
│   │   ├── ConnectionStatus.tsx     # WS health indicator
│   │   └── Controls.tsx             # Zoom, audio toggle, settings
│   │
│   ├── audio/                       # Sound management
│   │   ├── AudioManager.ts          # Howler.js wrapper
│   │   └── sounds.ts                # Sound registry + paths
│   │
│   ├── assets/
│   │   ├── sprites/                 # Character sprite sheets
│   │   │   ├── agent-1.png          # a16z/ai-town sprites (v1)
│   │   │   ├── agent-2.png
│   │   │   └── ...
│   │   ├── tiles/                   # Office tileset
│   │   │   └── office.png           # Simple placeholder (v1)
│   │   └── audio/                   # Sound files
│   │       ├── keyboard-loop.ogg
│   │       ├── coffee-brew.ogg
│   │       ├── ambient-hum.ogg
│   │       ├── agent-spawn.ogg
│   │       └── error-alert.ogg
│   │
│   └── types/
│       ├── agent.ts                 # Agent, AgentState, Station types
│       └── events.ts                # Shared event type definitions
│
└── public/
    └── favicon.ico                  # J.O.B.S. icon
```

---

## Office Layout (v1)

Simple 20x15 tile grid (16px tiles = 320x240 native, scaled up):

```
┌─────────────────────────────────────────────────┐
│                                                   │
│   ╔════════╗                    ╔════════╗        │
│   ║ WHITE  ║                    ║LIBRARY ║        │
│   ║ BOARD  ║                    ║/SEARCH ║        │
│   ╚════════╝                    ╚════════╝        │
│                                                   │
│   ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐       │
│   │ D1 │  │ D2 │  │ D3 │  │ D4 │  │ D5 │       │
│   │ 🖥️ │  │ 🖥️ │  │ 🖥️ │  │ 🖥️ │  │ 🖥️ │       │
│   └────┘  └────┘  └────┘  └────┘  └────┘       │
│                                                   │
│   ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐       │
│   │ D6 │  │ D7 │  │ D8 │  │ D9 │  │D10 │       │
│   │ 🖥️ │  │ 🖥️ │  │ 🖥️ │  │ 🖥️ │  │ 🖥️ │       │
│   └────┘  └────┘  └────┘  └────┘  └────┘       │
│                                                   │
│   ╔════════╗   ╔═══════════╗         ┌──────┐   │
│   ║TERMINAL║   ║  COFFEE   ║         │ DOOR │   │
│   ║ >_     ║   ║  MACHINE  ║         │  🚪  │   │
│   ╚════════╝   ╚═══════════╝         └──────┘   │
│                                                   │
└─────────────────────────────────────────────────┘
```

**Stations:**
- **Desks (D1-D10):** Assigned first-come-first-served. Coding, reading, writing states.
- **Whiteboard:** Thinking/planning. Multiple agents can cluster nearby.
- **Library:** Search/exploration. Agents browse shelves.
- **Terminal:** Command execution. Agents stand at a big terminal display.
- **Coffee Machine:** Idle/cooling between turns. Social area.
- **Door:** Entry/exit. Agents spawn here and walk to their desk.

---

## Docker Deployment

```yaml
# docker-compose.yml
version: '3.8'
services:
  jobs:
    build: .
    container_name: jarvis-jobs
    ports:
      - "8780:8780"    # Web UI + WebSocket
    volumes:
      - ${HOME}/.claude:/data/claude:ro   # Claude Code sessions (read-only)
    environment:
      - CLAUDE_DIR=/data/claude
      - PORT=8780
      - NODE_ENV=production
    restart: unless-stopped
    labels:
      - "com.jarvis.service=jobs"
```

**Single container** — serves both the static React frontend and the WebSocket server. No need for separate services in v1.

```bash
# Deploy
git clone https://github.com/maxthomas/jarvis-jobs.git
cd jarvis-jobs
docker compose up -d

# Access
open http://your-proxmox-host:8780
```

---

## Milestones

### Pre-M1 Remediation (docs/architecture-review/05-pre-m1-remediation.md)
> Blocking architecture fixes before M1 implementation.

- [x] React 19 + PixiJS 8 stack and no StrictMode in `main.tsx`
- [x] chokidar updated to v5-compatible directory watch + filter approach (no glob dependency)
- [x] Extracted bridge core modules + custom session manager lifecycle handling
- [x] WebSocket snapshot-on-connect hydration
- [x] Ghost timeout handling for stale sessions
- [x] M1 reduced-scope decisions applied (linear interpolation, 4 core event types)

### M1: Proof of Life (1-2 sessions)
> Get a character moving on screen driven by real Claude Code events.

- [x] Scaffold project (Vite + React + TypeScript)
- [x] Extract bridge core from pixelhq-bridge (5 files + local adaptation)
- [x] Simple WebSocket server broadcasting events
- [x] Basic PixiJS canvas with one hardcoded office room
- [x] One character sprite (a16z/ai-town) responding to WS events
- [x] State machine: idle -> walk to desk -> type -> walk to whiteboard -> think (M1 simplified mapping)
- [x] Linear interpolation between station positions (A* deferred to M2 per pre-M1 remediation)
- [x] Wire to real `~/.claude` session files
- **Deliverable:** Real coding session -> character animates on screen

### M2: Multi-Agent Office (1-2 sessions)
> Multiple characters, desk assignment, full event mapping.

- [x] Session Manager: detect multiple active sessions
- [x] Unique character assignment per agent (color palette swap)
- [x] Desk assignment system (FIFO)
- [x] All event types mapped to office behaviors (full table above)
- [x] Sub-agent spawning (new character enters when agent spawns)
- [x] Agent departure animation when session ends
- **Deliverable:** 3+ simultaneous Claude Code sessions = busy office

### M3: HUD & Feed (1 session)
> The "Surveillance" part of J.O.B.S.

- [x] `J.O.B.S. ONLINE` header with connection status
- [x] Agent Roster sidebar (name, state, session uptime)
- [x] Activity Feed ticker ("Agent-3 writing auth.ts")
- [x] Click agent in roster → highlight pulse on sprite
- [x] Basic Zustand devtools integration
- **Deliverable:** Full situational awareness of all agent activity

### M4: Audio & Ambient (1 session)
> Make it feel alive.

- [ ] Keyboard clacking (proximity to active desk)
- [ ] Coffee machine brewing (when agents idle)
- [ ] Ambient office hum (constant, low volume)
- [ ] Retro chimes: agent spawn, agent complete, error alert
- [ ] Audio toggle in controls
- [ ] Ambient effects: screen glow on active desks, clock showing real time
- **Deliverable:** Put it on a monitor, leave it running, it's beautiful

### M5: Docker & Polish (1 session)
> Production-ready self-hosted deployment.

- [x] Dockerfile (multi-stage: build frontend + run server)
- [x] docker-compose.yml with volume mount
- [ ] README with setup instructions
- [ ] Proper error handling (bridge disconnects, no sessions, etc.)
- [x] Reconnection logic for WebSocket
- [x] Loading state / "No active sessions" idle office scene
- **Deliverable:** `docker compose up -d` and done

### Future (v2+)
- [ ] Customizable office layouts (JSON tileset config)
- [ ] LimeZu Modern Office tileset upgrade
- [ ] PixelLab.ai custom office worker sprites
- [ ] LibreChat adapter (show chat bot activity)
- [ ] Generic webhook adapter
- [ ] Persistent stats dashboard (sessions today, files touched, etc.)
- [ ] "Screensaver mode" for wall-mounted displays
- [ ] Custom agent names / avatars
- [ ] Theme support (dark office, bright startup, cyberpunk)

---

## References

| Resource | URL | License |
|---|---|---|
| pixelhq-bridge | github.com/waynedev9598/pixelhq-bridge | MIT |
| a16z/ai-town (sprites + engine ref) | github.com/a16z-infra/ai-town | MIT |
| PixiJS | pixijs.com | MIT |
| @pixi/react | github.com/pixijs/pixi-react | MIT |
| Zustand | github.com/pmndrs/zustand | MIT |
| Howler.js | howlerjs.com | MIT |
| pathfinding (npm) | npmjs.com/package/pathfinding | MIT |
| LimeZu Modern Office (v1.5) | limezu.itch.io/modernoffice | Commercial use OK |
| PixelLab.ai (v2 sprites) | pixellab.ai | Subscription |
| freesound.org (audio) | freesound.org | CC0 |
