# 03 — Scope & Risk Assessment (Devil's Advocate)

**Reviewer:** Scope Realist / Devil's Advocate
**Date:** February 8, 2026

---

## 1. M1 Scope Reality Check

**Verdict: Achievable but only if you cut aggressively.**

VISION.md M1 (lines 319-330) claims "1-2 sessions" for:
- Scaffold project (Vite + React + TypeScript)
- Extract bridge core from pixelhq-bridge (4 files)
- Simple WebSocket server broadcasting events
- Basic PixiJS canvas with one hardcoded office room
- One character sprite (a16z/ai-town) responding to WS events
- State machine: idle → walk to desk → type → walk to whiteboard → think
- A* pathfinding between station positions
- Wire to real `~/.claude` session files

**Critical path analysis:** The items above contain at least 3 hidden sub-tasks that aren't obvious from the bullet points:
1. **Spritesheet format conversion** — ai-town sprites are in custom TypeScript format, not PixiJS JSON atlas. You need to write a converter before you can render anything. Budget: 1-2 hours.
2. **JSONL format discovery** — The raw JSONL uses tool names like `Write`, `Read`, `Bash`. The bridge event types in VISION.md (`tool.file_write`, `activity.thinking`) are an abstraction layer on top. You need to build or extract this mapping. Budget: 1-2 hours of reading JSONL + writing the adapter.
3. **The Zustand-PixiJS bridge** — This isn't a trivial wiring problem. You need imperative Zustand access from the PixiJS ticker loop, not React hooks. Getting this wrong means agent sprites don't update or React re-renders kill your framerate. Budget: 1 hour if you know the pattern, 3+ hours if you don't.

**What to CUT from M1 to guarantee a working demo:**

| Cut | Reason | Defer to |
|-----|--------|----------|
| A* pathfinding | Direct linear interpolation works identically on a 20x15 grid with no obstacles. Add A* in M2 when multiple agents need collision avoidance. | M2 |
| Full state machine (all 12 event types) | M1 only needs 4 states: `entering` (session.started), `coding` (tool.*), `thinking` (activity.thinking), `leaving` (session.ended). Skip coffee machine, library, sub-agents, error states. | M2 |
| Whiteboard station | Reduces station count from 6 to 3 (door, desk, terminal). Thinking can happen at the desk for M1. | M2 |
| Real `~/.claude` wiring | Use a **mock event generator** for M1 demo. Emit fake events on a timer. Wire to real files as the last M1 task or first M2 task. This de-risks the entire milestone — you can demo the visualization without solving file-watching. | Late M1 / Early M2 |

**Revised M1 scope (guaranteed demo in 1 session):**
1. Vite + React 19 + TypeScript + PixiJS 8 scaffold
2. Convert ai-town spritesheet → PixiJS JSON atlas (build script)
3. PixiJS canvas with hand-coded tilemap (2D array, 3 stations: door, desk, terminal)
4. One character sprite with walk cycle
5. Linear interpolation movement between stations
6. Mock event generator emitting 4 event types on a timer
7. Zustand store + imperative PixiJS bridge
8. Express + ws server broadcasting mock events
9. **Deliverable:** Open browser, see character walk between desk and terminal on mock events

---

## 2. a16z/ai-town Sprites — Will They Actually Work?

**Verdict: Yes, with caveats. They're more limited than VISION.md implies.**

**What exists:**
- **File:** `public/assets/32x32folk.png` (shared spritesheet, all characters on one PNG)
- **Data:** `data/spritesheets/f1.ts` through `f8.ts` (8 characters)
- **Format:** Custom TypeScript objects with `frames` and `animations` keys — NOT PixiJS JSON atlas format
- **Frame size:** 32x32 pixels per frame
- **Animations:** Walk cycles only — 4 directions x 3 frames = 12 frames per character
- **Characters:** 8 named characters (Lucky, Kurt, Alice, Bob, Alex, Stella, Pete, Kira) + 3 player variants

**What does NOT exist:**
- No sitting animation
- No typing animation
- No reading animation
- No idle/standing animation
- No "scribbling at whiteboard" animation
- No "drinking coffee" animation

**This means 8 of the 12 office behaviors in VISION.md's mapping table have no corresponding animation.** The walk cycle handles movement between stations, but every stationary activity (coding, reading, thinking, searching, planning, idle, error) needs to be faked.

**Realistic animation plan for v1:**

| Agent State | Available Animation | Fake It With |
|---|---|---|
| `entering` / `leaving` | Walk cycle (4-dir) | Works as-is |
| `coding` (at desk) | None | Static front-facing frame + 1px vertical bob every 0.5s |
| `reading` (at desk) | None | Static front-facing frame (no bob) |
| `thinking` (whiteboard) | None | Static left-facing frame + occasional 1px shift |
| `terminal` | None | Static front-facing frame + faster 1px bob |
| `searching` (library) | None | Static side-facing frame |
| `idle` (coffee) | None | Static front-facing frame + slow random facing changes |
| `error` | None | Static frame + red tint overlay on sprite |

**This will look "retro" but functional.** The v1.5 upgrade to LimeZu + PixelLab.ai sprites (VISION.md line 28) becomes more important given these limitations.

**Risk level: LOW.** The sprites will work. They just won't look as animated as the architecture implies. Set expectations accordingly.

---

## 3. The Empty Office Problem

**Verdict: This is a real UX gap. Most of the time, nobody is in the office.**

VISION.md has no design for the 0-session state. Consider the usage pattern:
- You start a Claude Code session → agent appears (takes 2-5 seconds to detect)
- Session runs for 5-30 minutes → agent is active
- Session ends → agent leaves
- **Next session might be hours or days later**

**The office will be empty 90%+ of the time.** If a user opens the dashboard and sees a blank/static screen, they'll think it's broken.

**Required empty state design:**

1. **The office itself should still be alive:**
   - Clock showing real time (ticking)
   - Occasional ambient flicker on desk monitors (screensaver mode)
   - Steam/particle effect on coffee machine
   - Lights on, nobody home aesthetic

2. **HUD should communicate clearly:**
   - Header: `J.O.B.S. ONLINE` (green dot) — system is working
   - Agent roster: "No active sessions" with a subtle pulse
   - Activity feed: "Watching for sessions..." or last known activity with timestamp
   - Prominent connection status: "Connected — waiting for activity"

3. **First-run experience:**
   - If `~/.claude/projects/` doesn't exist or is empty, show an onboarding message
   - "No Claude Code sessions detected. Start a session to see activity."
   - Maybe a "Test" button that spawns a mock agent to verify the system works

**Action:** Add an "Empty State" section to VISION.md. This is a M1 requirement — without it, you can't tell if the system is working or broken.

---

## 4. The "Works on My Machine" Problem

**Verdict: The glob pattern is correct but the directory structure has platform variance.**

**What we know:**
- Claude Code stores sessions in `~/.claude/projects/{encoded-path}/{uuid}.jsonl`
- The path encoding replaces `/` and `.` with `-` (e.g., `/Users/max/my-project` → `-Users-max-my-project`)
- The glob `**/*.jsonl` will match these files

**Platform risks:**

| Platform | `~/.claude` Location | Issue |
|----------|---------------------|-------|
| Linux (Proxmox host) | `/home/user/.claude` | Standard, works |
| macOS (dev machine) | `/Users/user/.claude` | Standard, works |
| Windows (WSL) | `/home/user/.claude` (inside WSL) | Docker mount path is different from Windows path |
| Windows (native) | `C:\Users\user\.claude` | Completely different path separator. Docker mount needs translation. |

**The Docker compose uses `${HOME}/.claude`** which resolves correctly on Linux and macOS. On Windows it depends on the shell environment.

**Additional concerns:**
- **What if the user hasn't used Claude Code yet?** The `~/.claude/projects/` directory might not exist. chokidar will error if the watch target doesn't exist.
- **What about Claude Code's `history.jsonl`?** It sits at `~/.claude/history.jsonl` and could be accidentally watched by `**/*.jsonl`. This file contains session metadata and should be explicitly excluded.

**Action:** Add a startup check that creates the watch directory if missing (or handles the "directory not found" gracefully). Exclude `history.jsonl` from the watcher pattern.

---

## 5. Top 3 Momentum Killers (Ranked)

### #1: Sprite Sheet Format Conversion
**Risk: HIGH. Impact: Blocks all visual progress.**

You cannot render a single character until the ai-town TypeScript sprite data is converted to PixiJS format. This is the first thing you'll hit and it's not a quick copy-paste. You need to:
1. Understand the ai-town `SpritesheetData` type
2. Map it to PixiJS `Spritesheet` JSON format
3. Handle the shared `32x32folk.png` atlas correctly
4. Get `AnimatedSprite` working with the converted data

If this takes longer than expected, you have zero visual progress to show. **Mitigate by doing the converter script FIRST, before any PixiJS canvas work.**

### #2: JSONL-to-Bridge Event Mapping
**Risk: MEDIUM-HIGH. Impact: Blocks real data integration.**

The VISION.md event types (`tool.file_write`, `activity.thinking`) are an abstraction. The raw JSONL has:
- `message.role === "assistant"` with `content[].type === "tool_use"` and `content[].name === "Write"`
- No explicit "thinking" event — you infer it from `role: "assistant"` messages without tool_use
- Turn boundaries aren't always clean — multi-tool turns have interleaved tool_use and tool_result blocks

The pixelhq-bridge adapter handles this mapping, but it's not a trivial pass-through. **Mitigate by logging raw JSONL to console for 10 minutes before writing any adapter code.** Understand the actual format first.

### #3: @pixi/react Dev Mode Quirks
**Risk: MEDIUM. Impact: Wastes 2-4 hours debugging a non-bug.**

The strict mode crash ([Issue #602](https://github.com/pixijs/pixi-react/issues/602)) means the PixiJS canvas will render as blank in development mode with React.StrictMode enabled. You'll think your code is broken when it's actually a known library bug. **Mitigate by disabling StrictMode around the canvas component from minute one, and add a code comment explaining why.**

### Honorable mention: Zustand-PixiJS bridge
If you use React hooks instead of imperative `getState()`/`subscribe()`, every WebSocket event will trigger a React re-render that propagates to PixiJS through the component tree. At 10 events/second, this causes visible jank. It's not a momentum killer per se (it "works"), but it creates a performance problem you'll chase for hours before realizing the architecture is wrong. **Mitigate by implementing the imperative bridge pattern from day 1.**

---

## 6. What's Missing from the Architecture?

| Missing Item | Matters for v1? | Action |
|---|---|---|
| **Empty state (0 sessions)** | YES — it's the default view | Design it. See section 3 above. |
| **Error handling (server)** | YES — watcher crashes, WS drops | Add basic try/catch + restart logic in M1. Proper error handling in M5. |
| **Loading state (client)** | YES — what shows while WS connects? | Simple "Connecting..." overlay. 5 lines of code. |
| **Responsive design** | NO | This is a dashboard for a specific monitor. Fixed resolution is fine for v1. |
| **Mobile** | NO | Not a mobile use case. |
| **Accessibility** | NO for v1 | Canvas-based rendering is inherently inaccessible. The HUD overlay (React) should be semantic HTML, but don't block on this. |
| **Testing strategy** | PARTIAL | Privacy stripping needs unit tests (security-critical). Everything else can be manual for v1. |
| **CI/CD** | NO | Self-hosted, manual deploy via Docker. |
| **Environment config** | YES | `CLAUDE_DIR`, `PORT`, `WS_PATH` should be env vars from day 1. Don't hardcode paths. |
| **Logging** | YES | Server should log session discovery, WS connections, errors. Use `console.log` for v1, structured logging later. |

---

## 7. Honest Milestone Resequencing

**Current order: M1 → M2 → M3 → M4 → M5**

**Recommended order: M1 → M2 → M3 → M5 → M4**

Rationale:
- **M4 (Audio) should be last.** It's purely cosmetic. Every other milestone adds functional value. Audio is a nice-to-have that can be added at any point without architectural impact.
- **M5 (Docker) should come before M4.** The deployment target is Docker on Proxmox. You want to verify that chokidar + bind mounts + inotify actually work in the real environment BEFORE polishing with audio. Discovering a Docker showstopper after building 4 milestones of features would be devastating.
- **Consider a M0.5: Docker smoke test.** Before M1, spend 30 minutes creating a minimal Dockerfile that runs a Node.js process with chokidar watching a bind-mounted directory. Verify that file changes on the host are detected inside the container. This de-risks the entire project in under an hour.

**Revised milestone sequence:**

```
M0.5: Docker smoke test (30 min)
  - Minimal Node.js + chokidar in Docker
  - Bind mount test with real ~/.claude directory
  - Verify inotify propagation on Proxmox

M1: Proof of Life (1-2 sessions) — REDUCED SCOPE
  - See revised scope in section 1 above

M2: Multi-Agent Office (1-2 sessions) — unchanged

M3: HUD & Feed (1 session) — unchanged

M5: Docker & Polish (1 session) — MOVED UP
  - Full Dockerfile, docker-compose, deployment

M4: Audio & Ambient (1 session) — MOVED TO LAST
  - Nice-to-have, no dependencies on it
```

---

## Summary: Top Actions Before M1

| # | Action | Why |
|---|---|---|
| 1 | **Run Docker smoke test with chokidar + bind mount** | De-risks the entire project in 30 minutes |
| 2 | **Write spritesheet converter script first** | Blocks all visual progress if delayed |
| 3 | **Log raw JSONL for 10 minutes before writing adapter** | Prevents format assumption errors |
| 4 | **Design the empty office state** | It's the default view, not an edge case |
| 5 | **Cut M1 scope: drop A*, limit to 4 event types** | Guarantees a working demo in 1 session |
| 6 | **Disable React.StrictMode around canvas** | Prevents 2-4 hours of debugging a known bug |
| 7 | **Use imperative Zustand bridge from day 1** | Prevents performance problems that are hard to diagnose |
| 8 | **Move M5 (Docker) before M4 (Audio)** | Validates deployment target before polishing |
