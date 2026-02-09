# 04 — Recommended VISION.md Changes

**Date:** February 8, 2026
**Source:** Architecture review reports 01-03

This document lists every recommended change to VISION.md, organized by section. Changes are tagged with priority and which report identified them.

---

## Blocking (Must Fix Before Any Code)

### B1. Tech Stack: React 18 → React 19
**Source:** Frontend Engineer (01, Section 1)
**Section:** Tech Stack table (line 152)

```diff
- | **UI** | React 18 + TypeScript | 18.x | Good PixiJS integration, you know it |
+ | **UI** | React 19 + TypeScript | 19.x | Required by @pixi/react v8; non-breaking for greenfield |
```

`@pixi/react` v8.0.5 (Dec 2025) requires React 19's JSX pragma and internal APIs. React 18 will not work.

### B2. Tech Stack: chokidar Glob Handling
**Source:** Backend Architect (02, Section 2)
**Section:** Tech Stack table (line 156)

```diff
- | **File Watching** | chokidar | 4.x | Same as pixelhq-bridge uses |
+ | **File Watching** | chokidar | 3.x | v4 dropped glob support; v3 bundles it. Match pixelhq-bridge. |
```

Or if staying on v4, add `fast-glob` as a companion dependency and note it.

---

## High Priority (Address in M1 Design)

### H1. Bridge Strategy: File Count and Explicit File List
**Source:** Backend Architect (02, Section 1)
**Section:** Decisions Locked In table (line 29)

```diff
- | **Bridge Strategy** | Extract core modules (watcher, parser, adapter, events) | ~4 files, skip iOS-specific code (Bonjour, auth) |
+ | **Bridge Strategy** | Extract core modules (watcher, parser, claude-adapter, pixel-events, types) | 5 files + write own session-manager. Skip session.ts, auth, bonjour, websocket. |
```

### H2. Event Flow: Fix JSONL File Naming
**Source:** Backend Architect (02, Section 3)
**Section:** Event Flow diagram (line 91)

```diff
- Claude Code writes to ~/.claude/projects/myapp/session.jsonl
+ Claude Code writes to ~/.claude/projects/-Users-max-myapp/{uuid}.jsonl
```

Files are UUID-named (e.g., `a1b2c3d4-e5f6.jsonl`), one per conversation. Directory names are path-encoded with dashes.

### H3. New Section: Session Lifecycle Edge Cases
**Source:** Backend Architect (02, Section 6)
**Location:** After "Event → Office Behavior Mapping" section

Add a new section documenting:

| Edge Case | Handling |
|-----------|----------|
| Crashed session (no "ended" event) | Staleness timer: 5-min → idle, 15-min → evict + free desk |
| Watcher starts with existing sessions | Scan last 50 lines of each JSONL, reconstruct state if < 15min old |
| Session file deleted | Treat as session end, transition to `leaving` |
| Session file grows large (10MB+) | Track byte offset, only read new appended lines |
| Rapid event bursts | Debounce state changes to 2-3/sec for animation smoothness |
| `history.jsonl` in watch path | Explicitly exclude from watcher |
| `~/.claude/projects/` doesn't exist | Create directory or handle gracefully, show onboarding message |

### H4. New Section: Privacy Allowlist
**Source:** Backend Architect (02, Section 7)
**Location:** After or within the Event Flow section

Add explicit allowlist of what the adapter broadcasts per tool type:

**Approach:** Deny-by-default. Only whitelisted fields pass through.

| Tool / Field | Broadcast | Strip |
|---|---|---|
| `tool_use.name` | YES (e.g., "Write", "Bash") | — |
| `tool_use.input` → file paths | Basename only (e.g., "auth.ts") | Full path |
| `tool_use.input` → code content | NO | Strip entirely |
| `tool_use.input` → bash commands | NO | Strip entirely |
| `tool_use.input` → search patterns | NO | Strip entirely |
| `tool_use.input` → URLs | NO | Strip entirely |
| `tool_result.content` | NO | Strip entirely |
| `message.content[].text` (assistant) | NO | Strip entirely |
| `cwd` | NO | Strip entirely |
| `gitBranch` | NO | Strip (configurable later) |
| `usage` (token counts) | YES | — |
| `timestamp` | YES | — |
| `uuid` / `sessionId` | Internal only | Don't broadcast raw |
| Error messages | Generic "error occurred" only | Strip stack traces, paths |

### H5. M1 Milestones: Add Spritesheet Conversion
**Source:** Frontend Engineer (01, Section 3) + Devil's Advocate (03, Section 2)
**Section:** M1 task list (lines 323-330)

Add after "Extract bridge core":
```
- [ ] Convert a16z/ai-town spritesheet data (TypeScript) to PixiJS JSON atlas format
- [ ] Verify AnimatedSprite walk cycles in all 4 directions
```

### H6. M1 Milestones: Add State Snapshot on WS Connect
**Source:** Backend Architect (02, Section 5)
**Section:** M1 task list

Add:
```
- [ ] Server sends full state snapshot (agents, states, desks) on WebSocket connect
```

### H7. Architecture: JSONL Tool Name → Bridge Event Mapping
**Source:** Backend Architect (02, Section 3)
**Location:** New table in Event Flow section

| Raw JSONL Tool Name | Bridge Event Type | Agent State |
|---|---|---|
| `Write`, `Edit`, `MultiEdit` | `tool.file_write` | `coding` |
| `Read` | `tool.file_read` | `reading` |
| `Bash` | `tool.terminal` | `terminal` |
| `Grep`, `Glob`, `LS` | `tool.search` | `searching` |
| `WebFetch`, `WebSearch` | `tool.search` | `searching` |
| `TodoRead` | `tool.plan` | `planning` |
| `Task` (spawn agent) | `tool.spawn_agent` | `delegating` |
| `role: "assistant"` (no tools) | `activity.thinking` | `thinking` |
| `role: "assistant"` (with text) | `activity.responding` | `coding` |

---

## Medium Priority (M2-M5)

### M1. New Section: Empty Office State
**Source:** Devil's Advocate (03, Section 3)
**Location:** After Office Layout section

Design the 0-session state:
- Office rendered with lights on, screens showing screensavers, clock ticking
- Coffee machine with steam particle effect
- HUD: "J.O.B.S. ONLINE" (green), "No active sessions — watching for activity"
- First-run: "No Claude Code sessions detected" with setup hint
- Optional "Test" button to spawn mock agent

### M2. Docker Deployment: inotify Limits
**Source:** Backend Architect (02, Section 2)
**Section:** Docker Deployment (lines 283-313)

Add to the deployment section:
```yaml
# Required on Proxmox host (cannot be set inside container):
# echo "fs.inotify.max_user_watches=524288" >> /etc/sysctl.conf
# sysctl -p
```

### M3. Architecture: Zustand-PixiJS Bridge Pattern
**Source:** Frontend Engineer (01, Section 7)
**Location:** New note in Architecture section or as code comment in AnimationController.ts

Document:
- Use `useOfficeStore.getState()` and `.subscribe()` imperatively from AnimationController
- Never use React hooks inside PixiJS render loop
- Use `@pixi/react` `<Application>` for mounting only; manage sprites imperatively
- Use `subscribeWithSelector` middleware for fine-grained updates

### M4. Architecture: WebGL Context Loss
**Source:** Frontend Engineer (01, Section 4)
**Location:** M5 task list

Add:
```
- [ ] Handle WebGL context loss/restore (important for long-running dashboard)
- [ ] Pause PixiJS ticker on document.visibilitychange (hidden)
```

### M5. Milestone Resequencing: M5 Before M4
**Source:** Devil's Advocate (03, Section 7)

```diff
  M1: Proof of Life
  M2: Multi-Agent Office
  M3: HUD & Feed
- M4: Audio & Ambient
- M5: Docker & Polish
+ M4: Docker & Polish (was M5)
+ M5: Audio & Ambient (was M4)
```

Rationale: Validate Docker + chokidar + bind mount on Proxmox before polishing with audio. Discovering a Docker showstopper late is the worst outcome.

### M6. Pre-M1: Docker Smoke Test
**Source:** Devil's Advocate (03, Section 7)

Add a "M0.5" or pre-flight check:
```
M0.5: Docker Smoke Test (30 minutes)
  - [ ] Minimal Node.js + chokidar in Docker
  - [ ] Bind mount ~/.claude directory (read-only)
  - [ ] Verify file change detection on Proxmox host
  - [ ] Confirm inotify propagation works
```

---

## Low Priority / Notes

### L1. Disable React.StrictMode Around Canvas
**Source:** Frontend Engineer (01, Section 1) + Devil's Advocate (03, Section 5)

In `main.tsx` or `App.tsx`, don't wrap the PixiJS `<Application>` component in `<StrictMode>`. Add a comment:
```typescript
// StrictMode disabled for PixiJS canvas — causes stale WebGL context in dev mode
// See: https://github.com/pixijs/pixi-react/issues/602
```

### L2. WebSocket Path Namespacing
**Source:** Backend Architect (02, Section 4)

Namespace WebSocket to `/ws` for clarity and future reverse proxy compatibility:
```typescript
const wss = new WebSocket.Server({ server, path: '/ws' });
```

### L3. Consider Environment Variables from Day 1
**Source:** Devil's Advocate (03, Section 6)

```
CLAUDE_DIR=/data/claude     # Watch directory
PORT=8780                   # HTTP + WS port
WS_PATH=/ws                 # WebSocket endpoint path
STALE_IDLE_MS=300000        # 5 minutes → idle
STALE_EVICT_MS=900000       # 15 minutes → evict
```
