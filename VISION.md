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
- **Mid-office (v2-M3):** Supervisor patrol zone. Team leads walk between sub-agent desks, check in, and pace here while waiting on results.

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

### M4: Audio & Ambient (deferred to v2)
> Make it feel alive.

- [x] Keyboard clacking (proximity to active desk)
- [x] Coffee machine brewing (when agents idle)
- [x] Ambient office hum (constant, low volume)
- [x] Retro chimes: agent spawn, agent complete, error alert
- [x] Audio toggle in controls
- [x] Ambient effects: screen glow on active desks, clock showing real time
- **Deliverable:** Put it on a monitor, leave it running, it's beautiful

### M5: Docker & Polish (1 session)
> Production-ready self-hosted deployment.

- [x] Dockerfile (multi-stage: build frontend + run server)
- [x] docker-compose.yml with volume mount
- [x] README with setup instructions
- [x] Proper error handling (bridge disconnects, no sessions, etc.)
- [x] Reconnection logic for WebSocket
- [x] Loading state / "No active sessions" idle office scene
- **Deliverable:** `docker compose up -d` and done

---

## v2 Roadmap

> v1 is a screensaver. v2 makes it a dashboard — you should be able to glance at it and know exactly what every agent is doing, whether any need your attention, and what they're working on.

### v2-M1: Agent Clarity — "What are they actually doing?"
> The single highest-impact upgrade. Surface the data we already have.

- [x] **Speech/thought bubbles** above sprites showing current activity
  - Thought cloud for thinking: `"Planning approach..."`
  - Terminal prompt for bash: `"> running tests"`
  - File icon for reads/writes: `"auth.ts"`
  - Search icon for grep/glob: `"handleLogin"`
  - Bubble auto-fades after a few seconds, replaced by next event
- [x] **"Waiting for human" detection** — the most important missing signal
  - Detect session silence (no new JSONL lines for N seconds after a result)
  - Differentiate: waiting for human input vs waiting for tool vs actively working
  - Prominent visual: sprite sits at desk tapping impatiently, `"?"` bubble or `"Waiting for you"`
  - Pulsing glow or color shift on the agent's desk to draw the eye
- [x] **Browser notifications** when an agent needs human input
  - Opt-in via controls panel
  - `"Agent-3 is waiting for your input (project: jarvis-jobs)"`
- [x] **Time-in-state indicator** above each sprite
  - Small timer or progress ring showing how long in current state
  - Color-coded: green (<1min active), yellow (1-5min same state), red (>5min idle/waiting)
  - Replaces the HUD-only uptime with in-canvas visibility
- [ ] **State-specific idle animations** improvements (deferred — requires richer sprite assets)
  - Waiting: tapping desk, looking at watch, checking phone
  - Error: head in hands, exclamation marks
  - Thinking: pacing, chin-stroking
  - Coding: faster typing animation, occasional head-scratch
- **Deliverable:** Glance at the office and instantly know who needs attention

### v2-M2: Context & Relationships — "What project? What team?"
> Connect agents to their work and to each other.

- [x] **Project labels** on agents
  - Show project/repo name beneath or beside the sprite (basename from session path)
  - Group agents by project in the HUD roster with collapsible sections
- [x] **Agent team visualization**
  - When a parent agent spawns sub-agents via Task, visually connect them
  - Shared desk cluster: parent at one desk, sub-agents at adjacent desks
  - Subtle connecting line or shared highlight color between team members
  - When parent is waiting on sub-agents, show that dependency: `"Waiting on 2 agents"`
- [x] **Agent detail panel** (click agent in roster or click sprite)
  - Expanded card showing: project name, current file/tool, state history timeline, session duration, tools used breakdown, parent/child relationships
  - Styled as a pixel-art dossier/file folder
  - Stays open until dismissed, updates in real-time
- [x] **Agent naming**
  - Auto-assign memorable names (e.g., "Ada", "Grace", "Linus") instead of UUID prefixes
  - Optional custom name override via config
- [x] **Session history timeline** in detail panel
  - Horizontal bar showing state transitions over time
  - Color-coded segments: blue=coding, purple=thinking, green=terminal, yellow=searching, gray=idle, red=error
  - Hover a segment to see what tool/file was active
- **Deliverable:** Understand the full context of every agent at a glance

### v2-M3: Supervisor Mode — "Who's the boss?"
> Parent agents become team leads who walk the floor and check on their sub-agents.

- [x] **Supervisor role detection** — automatically tag parent agents that spawned sub-agents
  - Parent agent (the one that called `tool.spawn_agent`) gets a `role: 'supervisor'` flag
  - Visual differentiation: distinct sprite, badge/hat overlay, or subtle glow/outline
  - HUD roster shows supervisor icon next to team lead agents
- [x] **Patrol behavior** — supervisors walk between their sub-agents' desks
  - When not actively coding/thinking, supervisor periodically walks to each child agent's desk
  - Patrol route visits each sub-agent in order, pauses briefly at each desk
  - Configurable patrol frequency (default: every 30-60 seconds of idle time)
- [x] **Check-in interactions** — supervisor "talks to" sub-agents
  - When supervisor arrives at a sub-agent's desk, play a brief interaction animation
  - Speech bubble from supervisor: `"Checking progress..."`, `"How's auth.ts?"` (uses child's current file context)
  - Sub-agent responds with their current state: `"Writing tests"`, `"Waiting for input"`
  - Interaction lasts 2-3 seconds before supervisor moves to the next agent
- [x] **Delegation visualization** — show the moment work is assigned
  - When `tool.spawn_agent` fires, supervisor walks to the door, new agent enters
  - Supervisor walks new agent to their assigned desk (escort animation)
  - Brief handoff animation: supervisor gestures at desk, sub-agent sits down
- [x] **Waiting-on-team state** — supervisor behavior while sub-agents work
  - When supervisor is waiting on sub-agent results, show them pacing or standing mid-office
  - Bubble: `"Waiting on 2 agents"` (count of active children)
  - When a sub-agent completes, supervisor walks over to "collect" the result
- [x] **Team summary in HUD** — supervisor section in roster
  - Collapsible team group headed by supervisor name
  - Shows: sub-agent count, how many active vs complete, team progress indicator
  - Click supervisor in roster to highlight the entire team (supervisor + all children)
- **Deliverable:** Parent agents visibly manage their team — walk the floor, check in, delegate, and wait for results

### v2-M4: Audio & Ambient — "Make it feel alive"
> The deferred v1-M4. Bring the office to life with sound and visual effects.

- [x] **Keyboard clacking** — proximity-based volume, active when agent is coding/typing
- [x] **Coffee machine** — brewing sound when agents visit coffee station
- [x] **Ambient office hum** — constant low-volume background (HVAC, murmur)
- [x] **Retro chimes** — distinct sounds for: agent spawn (door bell), agent complete (success jingle), error (alert tone), waiting for input (gentle notification)
- [x] **Audio toggle** in controls panel (mute/unmute, volume slider)
- [x] **Screen glow** on active desks — monitors emit subtle animated light when agent is coding
- [x] **Clock** showing real time on the office wall
- [x] **Steam/particles** from coffee machine when in use
- **Deliverable:** Put it on a monitor, leave it running, it's beautiful

### v2-M4.5: Audio Polish — "Make it sound right"
> Replace programmer-art oscillator sounds with real audio samples. The plumbing is done — AudioManager, store, event wiring, loop management, HUD controls all work. Just need better sounds.

- [x] **Source real samples** — freesound.org (CC0) office sounds
  - Keyboard clacking loop (mechanical keyboard, not too aggressive)
  - Coffee machine / kettle bubbling
  - Ambient office hum (HVAC, distant murmur)
  - Page turning / paper rustling
  - Terminal typing (clunkier than keyboard)
  - Paper shuffle / filing cabinet
  - Footsteps (agent walking from door to desk)
- [x] **Source chime samples** — freesound.org (CC0)
  - Door bell (arrival) — friendly two-tone
  - Door bell (departure) — softer/descending variant
  - Task complete — satisfying success jingle
  - Error alert — distinctive but not annoying
  - Waiting ping — gentle notification
  - Delegation chime — handoff motif
  - Check-in ping — subtle attention sound
- [x] **Switch to Howler.js** for file-based playback (replaces raw Web Audio API oscillators)
  - `npm install howler` + `@types/howler`
  - Rewrite AudioManager to load .ogg files via Howl instances
  - Keep the same `play()` / `startLoop()` / `stopLoop()` API
  - Pre-load all sounds on first `enabled` or `unlock()`
  - Fade-out with cancel-on-restart to prevent stacking
- [x] **Add .ogg files** to `src/assets/audio/` (14 files, ~2MB total, bundled by Vite)
- [x] **Tune volumes and timing** — per-sound volume config, 10s footstep cutoff
- [x] **Move one-shot triggers to AnimationController** — fires on state transitions (works with both events and snapshots)
- **Deliverable:** Sounds you'd actually want to leave on

### v2-M5: Visual Upgrade — "Make it gorgeous"
> Replace placeholder graphics with proper pixel art.

- [ ] **LimeZu Modern Office tileset** ($2.50, commercial use OK)
  - Proper desks, chairs, computers, bookshelves, coffee area
  - Wall decorations, plants, windows
  - Configurable via JSON tileset config
- [ ] **PixelLab.ai custom sprites** — AI-generated office worker characters
  - More than 8 characters, diverse appearances
  - Richer animation states (sitting, typing, standing, walking, gesturing)
  - Idle animations per station (not just direction + bob)
- [ ] **Day/night cycle** — office lighting shifts based on real time of day
- [ ] **Customizable office layouts** — JSON-driven tileset config
  - Users can rearrange desks, add rooms, resize office
  - Preset layouts: startup (open plan), corporate (cubicles), cozy (small team)
- [ ] **Theme support**
  - Dark office (default), bright startup, cyberpunk neon, retro terminal green
  - Affects tilemap colors, HUD styling, ambient lighting
- **Deliverable:** Screenshot-worthy pixel art office

### v2-M6: Dashboard & Integrations — "Beyond Claude Code"
> Turn J.O.B.S. into a persistent operational dashboard.

- [ ] **Persistent stats dashboard**
  - Sessions today, total session hours, files touched, tools used breakdown
  - Per-agent history: past sessions, average duration, most-used tools
  - Stored in SQLite or JSON file, survives restarts
- [ ] **"Screensaver mode"** for wall-mounted displays
  - Auto-zoom to active area, hide HUD when idle, cinematic camera pans
  - Show ambient stats overlay (sessions today, uptime)
  - Perfect for office TV or Proxmox display
- [ ] **LibreChat adapter** — show chat bot activity as additional agents
- [ ] **Generic webhook adapter** — accept events from any source via HTTP POST
  - Standardized event schema, map to office behaviors
  - Could visualize CI/CD, deployments, monitoring alerts
- [ ] **Multi-instance support** — watch multiple machines' Claude dirs
  - Aggregate sessions from multiple dev machines into one office
- **Deliverable:** A living, always-on dashboard for your AI operations

### Moonshot: Live Terminal View
> Click a sprite, see its live session — a visual Claude Code dashboard.

- [ ] **On-demand terminal streaming** — client subscribes to a session's raw output via WS
  - New WS message type: `{ type: 'terminal', sessionId, lines }`
  - Server streams parsed JSONL on request, stops when client unsubscribes
- [ ] **xterm.js panel** — slide-out or modal, styled to match pixel aesthetic
  - Shows conversation flow: assistant text, tool calls, results
  - Syntax highlighting for code blocks
  - Auto-scroll with pause-on-hover
- [ ] **Sub-agent tree view** — parent → child sessions, click any node to view
  - Collapsible tree in the terminal panel sidebar
  - Shows state and activity summary per node
  - Navigate between sessions without closing the panel
- [ ] **Access control** — localhost-only by default, optional token auth
  - Config flag: `TERMINAL_ACCESS=local|token|disabled`
  - Token auth for remote access behind reverse proxy
- [ ] **Unfiltered adapter path** alongside the privacy-stripped broadcast
  - Separate pipeline: raw JSONL → terminal formatter → subscribed clients only
  - Never broadcasts unfiltered data to all clients
  - Clear visual indicator when terminal view is active
- [ ] **Interactive mode** (stretch goal) — send input back to Claude Code session
  - Type in the terminal panel, input goes to the JSONL session
  - Essentially a remote Claude Code client embedded in J.O.B.S.
- **Deliverable:** Full visibility into any agent's session, from the office view

---

## References

| Resource | URL | License |
|---|---|---|
| pixelhq-bridge | github.com/waynedev9598/pixelhq-bridge | MIT |
| a16z/ai-town (sprites + engine ref) | github.com/a16z-infra/ai-town | MIT |
| PixiJS | pixijs.com | MIT |
| Zustand | github.com/pmndrs/zustand | MIT |
| Howler.js | howlerjs.com | MIT |
| pathfinding (npm) | npmjs.com/package/pathfinding | MIT |
| xterm.js | xtermjs.org | MIT |
| LimeZu Modern Office (v1.5) | limezu.itch.io/modernoffice | Commercial use OK |
| PixelLab.ai (v2 sprites) | pixellab.ai | Subscription |
| freesound.org (audio) | freesound.org | CC0 |
