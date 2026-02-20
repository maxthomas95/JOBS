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
| **Sprites (v1)** | Clawdachi GIF blob via @pixi/gif (replaced ai-town sprites) | Expressive, state-aware character from MIT Clawdachi project |
| **Tileset (v2-M5)** | LimeZu Modern Office tileset (private use), free default for GitHub | Paid tileset for personal setup; open-source default before publishing |
| **Sprites (v2)** | Clawdachi programmatic renderer (moonshot) | State-aware expressions, per-agent palettes, no external asset deps |
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
│     │  - Merges JSONL + hook data │                           │
│     └───────┬─────────┬──────────┘                            │
│             │         │                                       │
│    ┌────────┴───┐  ┌──┴──────────────┐                        │
│    │ Bridge Core│  │  Hook Receiver   │                        │
│    │ (pixelhq)  │  │  POST /api/hooks │                        │
│    │ - Watcher  │  │  (optional v2-M6)│                        │
│    │ - Parser   │  │                  │                        │
│    │ - Adapter  │  │  Accepts async   │                        │
│    │ - Events   │  │  hook payloads   │                        │
│    └────────┬───┘  └──┬──────────────┘                        │
│             │         │                                       │
└─────────────┼─────────┼──────────────────────────────────────┘
              │         │
   chokidar watch    HTTP POST from
              │      hook scripts
              │         │
  ~/.claude/projects/   Claude Code hooks
   **/*.jsonl           (async, non-blocking)
  (always-on,          (opt-in enhanced mode,
   zero-config)         fills accuracy gaps)
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

> v1 is a passive display. v2 makes it a dashboard — you should be able to glance at it and know exactly what every agent is doing, whether any need your attention, and what they're working on.

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
> Replace placeholder graphics with proper pixel art. Character sprites are covered by the Clawdachi Sprite System moonshot — this milestone focuses on the office environment.

- [x] **LimeZu Modern Office tileset** ($2.50, personal use — not redistributable)
  - Proper desks, chairs, computers, bookshelves, coffee area
  - Wall decorations, plants, windows
  - Tileset loader: parse sprite sheet into PixiJS textures, map tile IDs to positions
- [x] **JSON-driven tilemap config** — decouple layout from rendering
  - Tile-level map definition: `{ tileId, x, y }` array defining the office
  - Station positions derived from map config (replace hardcoded STATIONS)
  - Tileset-agnostic: same map config works with LimeZu images or programmatic fallback
- [x] **Day/night cycle** — office lighting shifts based on real time of day
- [ ] **Customizable office layouts** — preset and user-defined
  - Users can rearrange desks, add rooms, resize office via JSON
  - Preset layouts: startup (open plan), corporate (cubicles), cozy (small team)
- [x] **Theme support**
  - Dark office (default), bright startup, cyberpunk neon, retro terminal green
  - Affects tilemap colors, HUD styling, ambient lighting
- **Deliverable:** Screenshot-worthy pixel art office (LimeZu for personal use)

### v2-M6: Dashboard & Integrations — "Beyond Claude Code"
> Turn J.O.B.S. into a persistent operational dashboard. JSONL watching remains the zero-config foundation; hooks and webhooks layer on top for richer, lower-latency data when available.

- [x] **Claude Code hooks integration** — optional enhanced mode via Claude Code's hook system
  - **Hybrid architecture:** JSONL file watching stays as the primary, zero-config path. Hooks are an additive layer that fills gaps JSONL physically cannot — no breaking changes, pure enhancement
  - **Hook receiver endpoint** — `POST /api/hooks` on the existing Express server (port 8780)
    - Accepts hook JSON payloads, routes through session-manager like JSONL events
    - Server detects hook-active sessions (first hook event marks it) and uses hook data when available
    - Falls back gracefully to JSONL-only behavior when hooks aren't configured
  - **Ship a hook notify script** — `.claude/hooks/jobs-notify.sh` (or Node.js equivalent)
    - Reads hook JSON from stdin, POSTs to JOBS server
    - All hooks configured as `async: true` so they never slow down Claude's work
    - Setup helper: `node server/setup-hooks.js` writes hooks config to `~/.claude/settings.json`
  - **High-priority hooks** (solve real accuracy problems):
    - `Stop` → **replaces the 8-second waiting heuristic** — fires the instant Claude finishes responding, so "waiting for human" state is deterministic instead of a guess
    - `SubagentStart` / `SubagentStop` → **replaces the 10-second spawn window** — deterministic parent-child linking with `agent_id`, no timing-based matching
  - **Medium-priority hooks** (new states impossible via JSONL):
    - `Notification` (matcher: `permission_prompt`) → new **"Needs Approval"** agent state — agent could show a `"!"` bubble or walk to a new station. Currently invisible in JSONL
    - `SessionStart` / `SessionEnd` → explicit lifecycle with `reason` field (cleaner than file creation/staleness detection)
  - **Low-priority hooks** (nice-to-have enrichments):
    - `PreToolUse` → slightly lower latency than JSONL (~0ms vs ~200ms file-system delay)
    - `PreCompact` → new "Compacting memory..." visual state
    - `TeammateIdle` / `TaskCompleted` → richer supervisor mode awareness
  - **New agent states** enabled by hooks:
    - `needsApproval` — permission prompt waiting for human (from `Notification` hook)
    - `compacting` — context window being compressed (from `PreCompact` hook)
  - **Why hybrid, not hooks-only:**
    - Hooks require per-user setup (`~/.claude/settings.json`). JSONL watching works with zero config
    - Hooks are a newer, evolving API — the event set has changed significantly in recent months. JSONL format is stable
    - If a hook script fails/crashes, JSONL files still persist on disk as the safety net
    - Not all environments support hooks (older Claude Code versions, restricted setups)
- [x] **Persistent stats dashboard**
  - Sessions today, total session hours, files touched, tools used breakdown
  - Per-agent history: past sessions, average duration, most-used tools
  - Stored in SQLite or JSON file, survives restarts
- [x] **Follow mode** — single-agent camera tracking
  - Click FOLLOW on any agent in the roster to zoom in (1.8x) and track them
  - Smooth lerp camera with gentle drift, stays active until toggled off
  - Auto-unfollows when agent disconnects, smooth exit transition back to default view
- [x] **Generic webhook adapter** — accept events from any source via HTTP POST
  - `POST /api/webhooks` endpoint with standardized WebhookPayload schema (source_id, event, state, activity, url)
  - WebhookState→AgentState mapping (running, testing, building, deploying, analyzing, etc.)
  - Webhook agents are full office citizens — desks, pathfinding, bubbles, `wh:` prefixed IDs
  - Optional auth via `WEBHOOK_TOKEN` env var (Bearer header or body token field)
  - Heartbeat events to keep long-running agents alive
- [x] **Multi-instance support** — watch multiple machines' Claude dirs
  - Machine registry with deterministic color assignment (hash-based from 8-color palette)
  - `MACHINE_ID`/`MACHINE_NAME` env vars in hook notify scripts, extracted in hook-receiver
  - HUD: machine grouping toggle (Project | Machine) when multiple machines present
  - Machine headers with colored dots, per-agent machine indicators in project view
  - Webhook agents can specify `machine` field for remote machine origin
- [x] **OpenAI Codex adapter** — visualize Codex CLI sessions alongside Claude Code
  - `server/hooks/codex-notify.js` — Codex `notify` hook script, reformats `agent-turn-complete` → webhook POST
  - Turn-level granularity (not tool-level) — stable, zero-maintenance via Codex's notify hook
  - `setup-hooks.js --codex` flag writes `notify` line to `~/.codex/config.toml`
  - Provider badges in HUD: CODEX, CI, DEPLOY, MONITOR, WEBHOOK
  - Agent detail panel: provider, machine, source URL display
- **Deliverable:** A living, always-on dashboard for your AI operations — provider-agnostic, with optional enhanced accuracy via hooks

### v2-M7: Stabilization & Polish — "Make it bulletproof"
> Freeze features. Hunt every bug, smooth every edge, answer every "wait, why does it do that?" before moving on.

- [x] **Bug fixes & edge cases** — 5 critical bugs fixed (stale setTimeout eviction, client stale timers, tab wake delta spike, idle pose drift, stats index rebuild)
- [x] **Performance profiling** — memory leaks plugged (unbounded Maps, toolNameCache, Howl unload, JSONL streaming), ticker efficiency (DayNightCycle/clock caching, delta cap), WebSocket exponential backoff
- [x] **UX paper cuts** — scrollable agent list/detail panel, theme-aware CSS variables, shared STATE_LABELS, feed animations, reconnect indicator, follow/stats overlap fix
- [x] **Real-world stress testing** — snapshot broadcast throttle, WS maxPayload, graceful shutdown, fallback name collision guard, pendingSpawns filter, file cleanup on unlink
- [x] **Documentation pass** — make sure README reflects the actual current state
- **Deliverable:** A rock-solid daily driver — zero surprises

### v2-M8: Security Remediation — "Lock it down"
> Audit before anyone else ever touches this.

- [x] **WebSocket authentication** — `JOBS_TOKEN` env var enables shared-token auth (meta tag injection for browsers)
- [x] **Input sanitization audit** — `server/sanitize.ts` (safeString, safeUrl, safeEnum) + client-side URL validation
- [x] **Rate limiting / connection limits** — 120 req/min API, 50 WS global cap, 10 per-IP cap
- [x] **Docker hardening** — non-root user, read-only filesystem, cap_drop ALL, no-new-privileges, resource limits
- [x] **Dependency audit** — `npm audit fix`, @types moved to devDeps
- [x] **Content Security Policy headers** — CSP, X-Frame-Options, nosniff, Permissions-Policy
- **Deliverable:** Production-safe for network exposure — ready for public release prep

---

## Planned Features (Post-v2)

> Not moonshots — these are concrete, scoped features planned for public release. The kind of polish that makes J.O.B.S. usable by someone who isn't you.

### Settings Menu — "Let me tweak that"
> A proper settings panel so users can tune the experience to their liking.

- [ ] **Settings panel UI** — slide-out or modal, accessible from Controls bar
  - Pixel-art styled panel consistent with HUD aesthetic
  - Organized into sections: Audio, Display, Notifications
- [ ] **Per-sound volume sliders** — individual control over every sound category
  - Loops: keyboard typing, terminal typing, page turning, paper rustling, coffee brew, ambient hum, footsteps
  - One-shots: door bell, error alert, task complete, waiting ping, check-in ping, delegation chime
  - Master volume slider at the top, individual sliders below
  - Each sound has a mute toggle alongside its slider
- [ ] **Persist settings** — save all preferences to localStorage
  - Extend existing useAudioStore persistence to include per-sound volumes/mutes
  - Settings survive page refresh and reconnection
- **Deliverable:** Full control over the soundscape — kill the hum, crank the chimes, whatever you want

### Open-Source Tileset — "Ship it without a lawsuit"
> Before publishing on GitHub, create a free default tileset so the repo works out of the box without paid assets.

- [ ] **Upgraded programmatic tilemap** — replace colored rectangles with detailed code-drawn pixel art
  - Patterned floor tiles, desk details (monitors, keyboards, mugs), wall textures
  - Bookshelf spines, coffee machine detail, terminal screen glow
  - All drawn via PixiJS Graphics — zero external image assets, zero licensing concerns
- [x] **Tileset abstraction layer** — same JSON map config renders with either backend
  - Programmatic renderer: built-in, ships with repo (default)
  - Image renderer: loads LimeZu (or any compatible) sprite sheet when present in `src/assets/tiles/`
  - Auto-detect: if tileset images exist use them, otherwise fall back to programmatic
- [x] **LimeZu as optional premium skin** — documented upgrade path
  - README instructions: "Buy LimeZu Modern Office ($2.50), drop into `src/assets/tiles/`"
  - Tileset never committed to repo — `.gitignore` entry for image tilesets
  - JSON map config is identical for both renderers
- **Deliverable:** Repo works and looks good out of the box; LimeZu is a documented optional upgrade

### GitHub Publishing — "Open the doors"
> Everything needed to make J.O.B.S. a proper open-source project that anyone can clone and run.

- [x] **LICENSE file** — MIT (matches all dependencies and extracted code)
- [x] **Asset audit** — verify all bundled assets are redistributable
  - Audio: CC0 from freesound.org (safe)
  - Claude GIF sprite: MIT from Clawdachi (safe)
  - Tileset: programmatic default only (safe), LimeZu excluded via .gitignore
- [x] **README for external users** — setup, config, architecture overview
  - Clear "Quick Start" section: clone, install, `docker compose up`
  - Document environment variables and optional config
  - "Optional: Premium Tileset" section with LimeZu instructions
- [x] **Strip machine-specific config** — ensure no hardcoded paths or personal details
  - All paths use environment variables (`CLAUDE_DIR`, `PORT`)
  - No references to personal Proxmox setup in committed config
- [x] **Contributing guide** — basic PR/issue guidelines
- [x] **Screenshots / GIF demo** — visual proof the app works and looks great
  - Capture a 5-10 second GIF of agents working in the office (procedural tileset for repo, LimeZu for personal use)
  - Static screenshots showing: empty office, busy office (3+ agents), agent detail panel, different themes
  - Embed in README hero section — a GIF is worth 1000 words for GitHub discovery
- [x] **GitHub Actions CI** — automated quality gates on every PR
  - Lint (`eslint`), type-check (`tsc --noEmit`), build (`vite build`) steps
  - Badge in README showing build status
  - Fast pipeline — skip Docker build, just validate source
- **Deliverable:** `git clone` → `docker compose up` → working pixel office, for anyone

### Demo Mode — "Try before you wire"
> Let anyone experience J.O.B.S. instantly — no Claude Code sessions required. A built-in demo that showcases every feature using the mock event system that already exists server-side.

- [ ] **Client-side demo toggle** — `?demo=true` URL param or DEMO button in the HUD header
  - Activates mock event generation without requiring `MOCK_EVENTS` env var
  - Server accepts a WS message `{ type: 'startDemo', mode: 'normal' }` to begin mock playback
  - Mode selector: normal (single agent lifecycle), supervisor (team dynamics), webhook (multi-provider), multi (multi-instance)
  - Demo badge in corner: `"DEMO MODE"` with a stop button
- [ ] **Auto-demo on empty office** — optional feature for public-facing instances
  - When no real sessions are active for N minutes, automatically start demo playback
  - Real sessions instantly override demo agents (demo agents walk out, real ones walk in)
  - Configurable via `DEMO_IDLE_TIMEOUT` env var (default: disabled)
- [ ] **Guided walkthrough** (stretch goal) — tooltip-style tour for first-time visitors
  - Highlight each HUD element in sequence: roster, detail panel, activity feed, stats, controls
  - Skip button, auto-advance after 5s per tooltip
- **Deliverable:** Anyone can experience J.O.B.S. in 5 seconds — paste the URL, see agents working

### Dashboard / Kiosk Mode — "Put it on the wall"
> Full-screen mode optimized for wall-mounted displays, lobby screens, and always-on monitors.

- [ ] **Kiosk toggle** — `?kiosk=true` URL param or `K` keyboard shortcut
  - Hides browser chrome suggestion (fullscreen API)
  - Scales canvas to fill viewport, HUD elements resize proportionally
  - Larger fonts, thicker borders, higher contrast for distance viewing
  - Auto-hides mouse cursor after 3s of inactivity
- [ ] **Minimal HUD variant** — show only essential info in kiosk mode
  - Agent count badge, connection status dot, clock
  - Activity feed auto-scrolls with larger text
  - Agent names visible on sprites (larger labels)
  - Full HUD accessible via mouse hover on edges
- [ ] **Auto-rotate focus** — cycle through agents on a timer
  - Every 30s (configurable), camera smoothly pans to a different active agent
  - Shows their detail card briefly, then moves on
  - Pairs with follow mode zoom for close-up views
- **Deliverable:** A living wallpaper for your office — glance up and know what every agent is doing

---

## Moonshots

> Big, ambitious features that touch multiple systems and require significant effort. Each one would be a marquee feature — but they're not small.

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

### Moonshot: Clawdachi Sprite System — "Give them personality"
> Replace generic walking sprites with expressive, state-aware Clawdachi blobs that visually communicate what each agent is doing.
>
> **Inspiration:** [gonzchris/Clawdachi](https://github.com/gonzchris/Clawdachi) (MIT) — a macOS desktop companion that monitors Claude Code and reacts with pixel-art animations. The character is a 32x32 orange blob with rich expression states (thinking, planning, celebrating), particle effects (floating math symbols, lightbulb sparkles, confetti), and customizable accessories (hats, glasses, held items). All art is programmatically generated in Swift/SpriteKit via pixel matrices.
>
> **Current state:** Base Clawdachi GIF already integrated as the agent sprite via `@pixi/gif`. Single animation loop for all states. Agents move, pathfind, and interact using the existing blob — just no state differentiation yet.
>
> **Constraint:** No macOS available — cannot run the Swift app to export assets. All work must be reproducible on Windows using PixiJS, Canvas API, or manually-authored assets.

#### Phase 1: State-Specific Particle Effects (PixiJS overlays on existing GIF)
> Keep the base GIF blob. Layer PixiJS particle/graphic effects on top to differentiate agent states — the same approach Clawdachi uses in SpriteKit.

- [ ] **Per-agent effect container** — child Container attached to each AgentVisual, positioned above the sprite
  - Manages lifecycle: create on addAgent, destroy on removeAgent
  - Swaps active effect when agent state changes (via AnimationController state transition detection)
- [ ] **Thinking effect** — floating symbols rising and fading above the blob
  - Pool of characters (`+`, `−`, `×`, `=`, `%`, `?`, `!`, `∑`, `λ`) rendered as BitmapText or small Graphics
  - Spawn at random horizontal offsets, rise in gentle sine-wave arc, fade out over ~2s
  - 2-3 symbols visible at once, staggered spawn timing
- [ ] **Planning effect** — lightbulb with pulsing sparkles
  - Small lightbulb graphic (yellow fill, white highlight) floating above head
  - Tiny spark particles that pop in at random positions around the bulb, hold briefly, fade
  - Gentle vertical bob on the bulb itself
- [ ] **Waiting/idle effect** — question mark or ellipsis bob
  - `"?"` or `"..."` floating above head with slow vertical oscillation
  - Pop-in animation on state enter, fade-out on state exit
- [ ] **Coding/typing effect** — subtle screen glow + keystroke particles
  - Tiny bright dots emitting forward from the blob toward the desk (simulating keystrokes hitting screen)
  - Pairs with existing desk glow from AmbientEffects
- [ ] **Terminal effect** — command prompt indicator
  - `"> _"` text with blinking cursor above head
  - Green tint on the text for terminal aesthetic
- [ ] **Searching effect** — magnifying glass sweep
  - Small magnifying glass graphic that sways left-right above the blob
  - Optional: tiny book/page particles floating nearby
- [ ] **Error effect** — alarm burst
  - `"!"` or `"✕"` with red flash burst, existing red tint on sprite stays
  - Brief shake on the effect container (not the sprite, to avoid path desync)
- [ ] **Celebrating effect** — confetti burst
  - On task-complete or session-end, spray of colored pixel particles upward
  - Particles arc outward and downward with gravity, fade on landing
  - Pairs with existing `task-complete` audio one-shot
- [ ] **Effect transitions** — smooth crossfade between states
  - Outgoing effect fades out over 0.3s, incoming effect fades in
  - Prevents jarring pops when state changes rapidly
- **Deliverable:** Each blob visually communicates its current state without needing to read the HUD

#### Phase 2: Programmatic Sprite Renderer (port Swift pixel matrices to TypeScript)
> Full port of the Clawdachi rendering system. Generate sprite textures at runtime from pixel matrices, enabling expressions, outfits, and per-agent customization — all without needing macOS.

- [ ] **PixelArtGenerator.ts** — TypeScript equivalent of Clawdachi's `PixelArtGenerator.swift`
  - Accept 2D array of RGBA pixel data, render to offscreen Canvas
  - Convert to PixiJS Texture via `Texture.from(canvas)`
  - Nearest-neighbor filtering (`scaleMode: 'nearest'`) for crisp pixel art
- [ ] **ClawdachiBody.ts** — body sprite generation from pixel matrices
  - Port the 32x32 body shape with primary/shadow/highlight orange layers
  - Breathing animation: 4 frames via width/offset adjustments
  - Arm and leg sub-sprites (3x3 and 2x5 pixel blocks)
- [ ] **ClawdachiFace.ts** — expression system
  - 5 eye states: open, half-closed, closed, squint, squint-left
  - Mouth variants: smile, whistle, yawn, speaking-open, speaking-closed
  - Blink animation: 5-frame sequence (open → half → closed → half → open)
  - Map agent states to expressions: thinking=squint, coding=open+focused, error=squint, idle=blink cycle
- [ ] **ClawdachiPalette.ts** — color system for per-agent differentiation
  - Base palette: primary, shadow, highlight (orange default)
  - Alternative palettes for multi-agent: blue, green, purple, pink, red, teal, etc.
  - Assign palette per agent (replace characterIndex color-swap system)
- [ ] **ClawdachiOutfits.ts** — accessories and held items (stretch goal)
  - Hats: cowboy, top hat, beanie, propeller cap
  - Glasses: sunglasses, nerd glasses, 3D glasses
  - Held items: coffee mug, headphones
  - Supervisor differentiation: special hat or badge overlay
- [ ] **AnimatedClawdachi class** — replaces AnimatedGIF per agent
  - Composites body + face + outfit layers into a single Container
  - Tick-driven animation: breathing cycle, blink timer, expression changes
  - State-reactive: swap expression/pose based on agent state
  - Generates textures on-demand, caches per palette+expression combo
- [ ] **Transition from GIF to programmatic** — swap rendering backend
  - Feature flag: `CLAWDACHI_RENDERER=gif|programmatic` (default: gif)
  - Programmatic renderer produces same visual footprint (32x32, same anchor/positioning)
  - Phase 1 particle effects work identically with either renderer
- **Deliverable:** Fully expressive, customizable blob characters — no external asset dependencies, infinite palette variations, state-driven expressions

### Moonshot: Live Room Editor — "Make it yours"
> A WYSIWYG editor built into the office. Hit "Edit," drag furniture around, and the agents figure out the rest. Pathfinding grid regenerates on the fly so characters always know how to reach every station — no matter how weird your layout gets.
>
> **Why moonshot:** This touches nearly every system — tilemap rendering, station positions, pathfinding grid, collision data, layout persistence, and a full drag-and-drop UI layer. Each piece is tractable; the integration surface is what makes it big.

- [ ] **Edit mode toggle** — toolbar button or hotkey to enter/exit layout editing
  - Overlay grid lines on the tilemap showing the pathfinding grid
  - Agents freeze in place while editing (pause animation controller)
  - Visual indicator: "EDITING" badge, dimmed HUD, highlighted grid
  - Exit edit mode: agents resume, pathfinding recalculates, positions validate
- [ ] **Furniture palette** — sidebar panel listing placeable objects
  - Categories: Desks, Stations (whiteboard, terminal, library, coffee), Decor (plants, shelves, rugs), Walls/Doors
  - Each item shows: sprite preview, tile footprint (e.g., 2x1), station type (if any)
  - Drag from palette onto grid, or click-to-place
- [ ] **Drag-and-drop placement** — move furniture on the tile grid
  - Snap to grid (16px tiles), ghost preview while dragging
  - Collision detection: red highlight if overlapping another object or blocking the only path to a station
  - Rotate furniture (90° increments) where applicable
  - Delete: drag to trash or right-click → remove
- [ ] **Dynamic pathfinding rebuild** — A* grid updates live as furniture moves
  - Mark tiles as walkable/blocked based on placed furniture footprints
  - Recompute walkability grid on every placement/removal
  - Validation pass: ensure every station is reachable from the door — block placement if it would strand a station
  - Visual feedback: briefly flash unreachable tiles in red if a placement fails validation
- [ ] **Station auto-registration** — placing a "desk" or "terminal" furniture piece auto-registers it as a station
  - Station type inferred from furniture type (desk furniture = desk station, terminal furniture = terminal station, etc.)
  - Agent-facing position auto-detected from furniture orientation (chair side of desk)
  - Desk numbering auto-assigned (D1, D2, ... in placement order)
  - Removing a station with an assigned agent: agent walks to nearest available station of the same type, or to the door if none
- [ ] **Layout persistence** — save/load room configurations
  - Save to localStorage (quick) and exportable as JSON file
  - Layout JSON schema: `{ tiles: [...], furniture: [...], stations: [...], meta: { name, gridSize } }`
  - Import/export buttons in the editor toolbar
  - Default layout ships with the app (current hardcoded layout as JSON)
- [ ] **Preset layouts** — bundled room templates to start from
  - "Classic" (current 10-desk layout), "Startup" (open plan, bean bags), "Corporate" (cubicle rows), "Cozy" (small 4-desk team room)
  - "Load Preset" dropdown in editor, overwrites current layout (with confirmation)
- [ ] **Undo/redo** — edit history stack
  - Ctrl+Z / Ctrl+Y (or toolbar buttons) to step through placement history
  - Stack clears on exit edit mode
- [ ] **Multi-floor / room resize** (stretch goal) — expand beyond 20x15
  - Drag canvas edges to resize the grid (max cap TBD, performance-dependent)
  - Multiple rooms connected by doors (each room is a separate grid, door tiles link them)
  - Agents pathfind across rooms via door transitions
- **Deliverable:** Your office, your rules — drag desks, rearrange stations, and the little guys figure it out

### Moonshot: Time-Lapse Replay — "Rewind the day"
> Record every event, replay the entire day at high speed. Like a security camera playback for your AI workforce.

- [ ] **Event recording** — persist all PixelEvents to a replayable log
  - Server writes timestamped event stream to `data/replay-YYYY-MM-DD.jsonl`
  - One file per day, auto-rotated, configurable retention (default: 7 days)
  - Includes all agent lifecycle events, state transitions, tool usage
- [ ] **Replay engine** — client-side event playback with time control
  - Load a replay file via `/api/replay/:date` endpoint
  - Playback speeds: 1x, 5x, 10x, 50x, 100x
  - Scrub bar with time markers showing agent activity density
  - Play/pause, skip forward/backward by 5 minutes
- [ ] **Visual timeline** — minimap of the day's activity
  - Horizontal bar showing active agents over time (stacked colored segments)
  - Click anywhere on the timeline to jump to that moment
  - Hover to preview: "3 agents active, Ada writing auth.ts"
- [ ] **Side-by-side comparison** (stretch goal) — replay two days simultaneously
  - Split view: yesterday's office vs today's office
  - Useful for spotting patterns (when are agents most active, common error times)
- **Deliverable:** Watch your entire day of AI coding condensed into 60 seconds — mesmerizing and insightful

### Moonshot: Multi-Tool Agent Adapters — "One office, every AI"
> Purpose-built adapters for other AI coding tools, so J.O.B.S. becomes the unified dashboard for all your AI agents — not just Claude Code.
>
> **Current state:** The generic webhook adapter (`POST /api/webhooks`) already supports any tool that can send HTTP. The Codex CLI adapter proves the pattern works. But purpose-built adapters with file watchers can provide zero-config, real-time granularity — just like the Claude Code JSONL integration.

- [ ] **Cursor adapter** — watch Cursor's session/log files
  - Detect Cursor's workspace state files or extension logs
  - Map Cursor actions (edit, generate, chat, apply) to agent states
  - Zero-config file watcher (like Claude's JSONL), with webhook fallback
- [ ] **Windsurf adapter** — watch Codeium/Windsurf activity
  - Similar approach: detect activity files, map to agent states
  - Provider badge: `WINDSURF`
- [ ] **Aider adapter** — parse Aider's git-based workflow
  - Watch for Aider's commit messages and chat history files
  - Map to states: thinking, coding (commit), searching (repo map)
  - Provider badge: `AIDER`
- [ ] **Generic file watcher template** — make it easy to add new tools
  - Abstract base class: define log file location + event parser
  - Documentation: "Add your AI tool in 50 lines"
  - Community contribution path for tools we don't use ourselves
- **Deliverable:** Every AI coding tool in one office — Claude, Codex, Cursor, Windsurf, Aider, side by side

### Moonshot: Spectator Mode — "Watch from anywhere"
> Shareable, read-only links that let teammates or friends watch your office without running their own instance.

- [ ] **Spectator route** — lightweight viewer with no controls
  - `/spectate` or `/spectate/:token` route serving a minimal client
  - Read-only WebSocket connection: receives snapshots and events, cannot send commands
  - No HUD controls (no follow, no audio toggle) — just watch
  - Mobile-friendly: responsive canvas, touch-friendly agent labels
- [ ] **Shareable links** — generate time-limited or permanent spectator URLs
  - `POST /api/spectate/link` generates a unique token (UUID)
  - Optional expiry: 1 hour, 24 hours, permanent
  - Revoke links via `DELETE /api/spectate/link/:token`
  - Rate-limited: max 5 active spectator links
- [ ] **Spectator count indicator** — show how many people are watching
  - Small eye icon + count in the owner's HUD: `"3 watching"`
  - Spectators see each other's cursor positions (optional, for fun)
- [ ] **Embed mode** — iframe-friendly spectator view
  - `?embed=true` strips all chrome, outputs just the canvas
  - Suitable for embedding in Notion pages, blog posts, dashboards
  - Configurable dimensions via URL params
- **Deliverable:** Share a link, let your team watch the AI workforce in real-time — from anywhere

### Moonshot: Agent Personality System — "Give them character"
> Assign persistent personality traits to agent names that affect their visual behavior. Ada is always methodical. Linus is always fast. Grace never panics. Pure flavor, zero data dependency.

- [ ] **Personality trait definitions** — small set of behavioral modifiers
  - Speed: `fast` (1.5x animation), `normal` (1x), `deliberate` (0.7x)
  - Anxiety: `calm` (smooth transitions, no error shake), `nervous` (jittery idle, dramatic errors)
  - Sociability: `social` (walks closer to other agents' desks on coffee breaks), `focused` (beelines desk-to-station)
  - Style: `tidy` (precise pathfinding, minimal wandering), `chaotic` (occasional random detours)
- [ ] **Name-to-personality mapping** — deterministic from agent name
  - Hash the name to pick trait values (same name always gets same personality)
  - Override via config file: `personalities.json` with `{ "Ada": { speed: "deliberate", anxiety: "calm" } }`
- [ ] **Visual expression** — personality affects animations
  - Fast agents: quicker walk cycle, snappier transitions
  - Nervous agents: idle fidget animation, exaggerated error reaction
  - Social agents: linger near other agents at the coffee machine, occasional "wave" interaction
  - Chaotic agents: take slightly non-optimal paths, wander during idle
- [ ] **Personality badge** — optional indicator in agent detail panel
  - Small trait summary: `"Calm, Deliberate, Focused"`
  - Visible in roster on hover
- **Deliverable:** Every agent feels like an individual — not just a different color, but a different character

### Moonshot: AI-Generated Floor Plans — "Describe your office"
> Type what you want, get a floor plan. Uses LLM structured output to generate valid map JSON from natural language descriptions.

- [ ] **Prompt-to-layout pipeline** — natural language → map config JSON
  - Input: `"Cozy 4-person office with a big library and a balcony"` or `"Open plan startup with 20 desks and a ping pong table"`
  - Output: valid MapConfig JSON (tile grid, stations, walkability)
  - Use Claude API (or any LLM with structured output) with the MapConfig JSON schema as the output format
  - Validate: all stations reachable from door, walkability grid consistent, desk count matches request
- [ ] **Preview and tweak** — show generated layout before applying
  - Render preview in a modal before committing
  - "Regenerate" button for a new attempt
  - "Apply" commits to the live office (agents reposition)
- [ ] **Prompt templates** — quick presets with customizable parameters
  - "Startup (N desks)" — open plan, bean bags, whiteboard wall
  - "Corporate (N desks)" — cubicle rows, corner offices, conference room
  - "Home office (N desks)" — cozy, plants, window seats
  - Slider for desk count, dropdown for vibe
- [ ] **Layout gallery** — community-shared floor plans
  - Export layout as shareable JSON (with metadata: name, description, author)
  - Import from URL or paste JSON
  - Curated gallery of interesting layouts (stretch goal)
- **Deliverable:** "Make me a cyberpunk hacker den with 8 desks" → it just works


### Outbound Notifications — "Tell the team"
> Push alerts to Slack, Discord, or any webhook endpoint when agents need attention or finish work.

- [ ] **Notification rules engine** — configurable triggers
  - Agent enters "waiting for human" → notify immediately
  - Agent errors → notify with error context
  - Agent completes session → summary notification (tools used, duration)
  - All agents idle for N minutes → "office is quiet" digest
- [ ] **Slack integration** — native webhook format
  - `SLACK_WEBHOOK_URL` env var for zero-config setup
  - Rich message formatting: agent name, state, project, duration
  - Thread replies for follow-up events on the same agent
- [ ] **Discord integration** — native webhook format
  - `DISCORD_WEBHOOK_URL` env var
  - Embed formatting with color-coded state indicators
- [ ] **Generic outbound webhook** — for any HTTP endpoint
  - `NOTIFY_WEBHOOK_URL` env var with standardized JSON payload
  - Configurable event filter (which events trigger notifications)
  - Retry with exponential backoff (3 attempts, then drop)
- **Deliverable:** "Ada needs your input" pops up in Slack — never miss a waiting agent again

---

## The Whiteboard — "Ideas sketched out, not committed"

> Features that are scoped out and ready to build — but not on any timeline. The kind of thing we'd pick up if the community asks for it, or if a rainy weekend lines up with motivation. Not saying no, just not saying when.

### Sound Packs — "Change the vibe"
> Swap between audio themes to match your mood or office aesthetic.

- [ ] **Sound pack abstraction** — decouple sound IDs from file paths
  - Sound pack config: `{ id, name, files: Record<SoundId, string> }` mapping
  - AudioManager loads files from the active pack
  - Packs can override individual sounds or provide a full set
- [ ] **Built-in packs** — ship with 2-3 options
  - `office` (default) — current CC0 office sounds
  - `retro-arcade` — 8-bit chiptune typing, coin-collect chimes, arcade ambient
  - `nature` — rain ambience, bird chirps for notifications, wind for idle
- [ ] **Custom sound pack support** — drop a folder, get new sounds
  - Place files in `src/assets/audio/{pack-name}/` matching expected sound IDs
  - Auto-discovered at build time, selectable in settings
- [ ] **Pack selector in settings** — dropdown or radio buttons in the Settings Menu
  - Preview button to hear a sample of each pack
  - Persists selection to localStorage
- **Deliverable:** Same office, completely different feel — retro arcade one day, rainy cabin the next

### Keyboard Shortcuts — "Power user mode"
> Quick access to every control without hunting for tiny buttons.

- [ ] **Core shortcuts** — immediate impact, no config needed
  - `M` — toggle audio mute
  - `T` — cycle theme (dark → bright → neon → retro)
  - `D` — toggle day/night cycle
  - `N` — toggle browser notifications
  - `Escape` — unfollow agent / close detail panel / exit demo mode
  - `F` — follow the currently selected agent
  - `S` — toggle stats panel
- [ ] **Navigation shortcuts** — move between agents
  - `Tab` / `Shift+Tab` — cycle through agents in roster order
  - `1`-`9` — select agent by roster position
  - `Enter` — open detail panel for selected agent
- [ ] **Shortcut hint overlay** — `?` key shows all available shortcuts
  - Semi-transparent overlay listing all bindings
  - Dismisses on any keypress or click
- **Deliverable:** Never touch the mouse — full control from the keyboard

### Stats Export — "Show me the numbers"
> Get your agent productivity data out of J.O.B.S. for analysis, reporting, or bragging rights.

- [ ] **CSV export** — one-click download from the stats panel
  - Session history: agent name, project, start time, end time, duration, tools used
  - Daily summary: date, session count, total hours, top tools
  - Filename: `jobs-stats-YYYY-MM-DD.csv`
- [ ] **JSON export** — full stats dump for programmatic consumption
  - Same data as `/api/stats` endpoint but as a downloadable file
  - Useful for feeding into dashboards (Grafana, Google Sheets, etc.)
- [ ] **Date range filter** — export specific time periods
  - Quick presets: Today, This Week, This Month, All Time
  - Custom date picker for arbitrary ranges
- **Deliverable:** Your AI coding metrics, in a spreadsheet — track trends, prove value, settle arguments

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
| LimeZu Modern Office (v2-M5) | limezu.itch.io/modernoffice | Paid, not redistributable — personal use only, not bundled in repo |
| freesound.org (audio) | freesound.org | CC0 |
| Clawdachi (sprite inspiration) | github.com/gonzchris/Clawdachi | MIT |
