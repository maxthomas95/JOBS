# J.O.B.S. — Pre-M1 Remediation Plan

**Based on:** Agent Team Architecture Review (Feb 8, 2026)
**Status:** All 12 issues triaged, solutions defined

---

## BLOCKING — Must Fix Before Writing Any Code

### Issue #1: @pixi/react v8 Requires React 19

**Confirmed.** The @pixi/react v8 blog post explicitly states: "designed exclusively for React 19." The v8 rewrite uses a new react-reconciler version that only works with React 19. There is no React 18 compatibility.

**Fix:** Update tech stack to React 19 + @pixi/react v8 (PixiJS v8).

```json
// package.json dependencies
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "pixi.js": "^8.0.0",
  "@pixi/react": "^8.0.0"
}
```

**Additional notes:**
- React 19 is stable (released Dec 2024), so this isn't risky
- Zustand 5.x supports React 19 natively
- Vite has no React version constraints
- The v8 API is different — uses `extend()` pattern and `<Application>` instead of `<Stage>`, with `<pixiSprite>` instead of `<Sprite>`
- **Disable React Strict Mode** in dev to avoid the known double-render crash (pixi-react Issue #602)

```tsx
// main.tsx — NO StrictMode wrapper
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
// NOT: <StrictMode><App /></StrictMode>
```

**VISION.md change:** React 18 → React 19 in tech stack table.

---

### Issue #2: chokidar v4+ Dropped Glob Support

**Confirmed.** chokidar v4 (Sep 2024) and v5 (Nov 2025) removed glob pattern matching. The pixelhq-bridge uses `**/*.jsonl` glob patterns which won't work.

**Fix:** Two options, use option A:

**Option A (recommended): Watch directory recursively + filter with `ignored`**
```typescript
import { watch } from 'chokidar';

// chokidar v4/v5 style — watch the whole directory, filter to .jsonl
const watcher = watch('/data/claude/projects', {
  ignored: (path, stats) => stats?.isFile() && !path.endsWith('.jsonl'),
  persistent: true,
  ignoreInitial: false,
});

watcher.on('change', (filePath) => {
  // Only .jsonl files will trigger this
  handleNewLines(filePath);
});
```

**Option B: Pin chokidar v3**
```json
{ "chokidar": "^3.6.0" }
```
Works but uses an older version with 13 dependencies instead of 1. Not recommended.

**VISION.md change:** Note chokidar v5 with filter pattern, not glob.

---

## HIGH PRIORITY — Address During M1 Build

### Issue #3: Bridge Extraction is 5 Files, Not ~4

**Acknowledged.** The actual files to extract are:
1. `watcher.ts` — file watching
2. `parser.ts` — JSONL parsing
3. `adapters/claude-code.ts` — privacy stripping
4. `pixel-events.ts` — event factories + privacy utils
5. `types.ts` — TypeScript type definitions

The review correctly notes that `session.ts` (agent state machine) should NOT be extracted — we write our own `session-manager.ts` that handles multi-session tracking and desk assignment, which is different from the bridge's single-session model.

**Fix:** Update project structure to list 5 extracted files. Write our own session manager.

---

### Issue #4: JSONL Files Are UUID-Named, Not `session.jsonl`

**Important catch.** Claude Code sessions produce files like:
```
~/.claude/projects/myapp/01234567-89ab-cdef-0123-456789abcdef.jsonl
```

Not `session.jsonl`. New sessions create new UUID files.

**Fix:** The watcher already handles this if we watch the directory recursively — any new `.jsonl` file appearing triggers watching. The session ID comes from the filename (UUID). Our session manager maps UUID → agent.

```typescript
// session-manager.ts
watcher.on('add', (filePath) => {
  const sessionId = path.basename(filePath, '.jsonl'); // UUID
  sessionManager.registerSession(sessionId, filePath);
});
```

**VISION.md change:** Update event flow diagram to show UUID-named files.

---

### Issue #5: ai-town Sprites Need Format Conversion + Limited Animations

**True.** The ai-town sprites define spritesheet data in TypeScript objects (frame coordinates, animation sequences), but PixiJS v8 expects JSON atlas format or programmatic `Spritesheet` creation.

Also, ai-town sprites only have walk cycles (up/down/left/right) and idle. No sitting, typing, or thinking poses.

**Fix for M1 (minimal):**
1. Write a small converter script that takes ai-town's TS spritesheet definitions and outputs PixiJS-compatible `Spritesheet` data
2. For missing animations, fake them:
   - **Sitting/typing:** Use the idle-down frame + add a small bounce/bob effect programmatically
   - **Thinking:** Use idle-up frame + add a thought bubble sprite overlay
   - **Terminal:** Use idle-left/right frame at the terminal station
   - **Coffee:** Use idle-down frame near the coffee machine

This is fine for M1. Replace with proper sprites in M4/v1.5.

```typescript
// Fake sitting animation from idle frame
const sittingAnimation = {
  frames: [idleDownFrame], // Single frame
  animationSpeed: 0,
  // Add programmatic bob via onRender
  onRender: (sprite) => {
    sprite.y += Math.sin(Date.now() / 300) * 0.5; // Subtle bob
  }
};
```

---

### Issue #6: Privacy Stripping Gaps

**Valid concern.** The pixelhq-bridge adapter strips most sensitive data, but the review flagged potential gaps: `cwd` paths, `gitBranch`, tool result bodies, fetched URLs.

**Fix:** When extracting the adapter, audit the allowlist against current Claude Code JSONL schema. Add these to the strip list:

```typescript
// Additional fields to strip in our adapter
const ADDITIONAL_STRIP_FIELDS = [
  'cwd',           // Full working directory path
  'gitBranch',     // Could reveal project info
  'result',        // Tool result bodies (may contain secrets)
  'url',           // WebFetch URLs
  'query',         // WebSearch queries
  'content',       // Any content field
];
```

Since we're self-hosted on a trusted network this is lower risk than the iOS app (which transmits over WiFi), but still good practice.

---

### Issue #7: Session Lifecycle Edge Cases

**Legit gap.** What happens when:
- Claude Code crashes mid-session (no `session.ended` event)
- J.O.B.S. server restarts while sessions are active
- A JSONL file stops being written to (user closed terminal)

**Fix:** Implement timeout-based ghost detection in session manager:

```typescript
// session-manager.ts
const GHOST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes no activity = ghost

setInterval(() => {
  for (const [id, agent] of agents) {
    if (Date.now() - agent.lastEventTimestamp > GHOST_TIMEOUT_MS) {
      agent.state = 'leaving';
      // Animate walk to door, then remove
      setTimeout(() => agents.delete(id), 3000);
    }
  }
}, 30_000); // Check every 30s
```

For server restart recovery: on startup, scan existing JSONL files, check last modification time, and restore any that were active recently.

---

### Issue #8: No State Snapshot on WS Connect

**Good catch.** If you open a second browser tab (or refresh), the new WebSocket client sees an empty office because it missed all prior events.

**Fix:** Send a full state snapshot when a new client connects:

```typescript
// ws-server.ts
wss.on('connection', (ws) => {
  // Send current office state to new client
  const snapshot = {
    type: 'snapshot',
    agents: Array.from(sessionManager.getAgents()),
    timestamp: Date.now(),
  };
  ws.send(JSON.stringify(snapshot));
});
```

Client-side, the Zustand store handles `snapshot` events by hydrating the full agent list.

---

## MEDIUM PRIORITY — Address in M2-M3

### Issue #9: Zustand-PixiJS Bridge Pattern

**Risk:** Naive approach of subscribing PixiJS sprites to Zustand state via React re-renders will cause performance issues with many agents.

**Fix (implement in M2):** Use Zustand's `subscribe` outside of React to push updates directly to PixiJS objects, bypassing React reconciliation:

```typescript
// Direct Zustand → PixiJS bridge (no React re-render)
useOfficeStore.subscribe(
  (state) => state.agents,
  (agents) => {
    // Update PixiJS sprites directly via refs
    for (const agent of agents.values()) {
      const sprite = spriteRefs.get(agent.id);
      if (sprite) {
        sprite.targetPosition = agent.targetStation.position;
        sprite.animationState = agent.state;
      }
    }
  }
);
```

For M1, the naive React approach is fine with 1-3 agents.

---

### Issue #10: WebGL Context Loss

**Edge case.** WebGL contexts can be lost when GPU resources are reclaimed (tab backgrounded, GPU pressure, etc.).

**Fix (implement in M3):** PixiJS v8 has built-in context loss handling. Add a listener:

```typescript
app.renderer.on('context-lost', () => {
  console.warn('J.O.B.S.: WebGL context lost, attempting recovery...');
});
app.renderer.on('context-restored', () => {
  console.log('J.O.B.S.: WebGL context restored');
  // Reload sprite textures
});
```

For M1, ignore this. It'll auto-recover in most cases.

---

### Issue #11: inotify Limits on Proxmox

**Valid for production.** Docker containers inside Proxmox LXC/VMs may hit default inotify watch limits.

**Fix (document in M5):** Add to README/docker-compose:

```yaml
# docker-compose.yml
services:
  jobs:
    # ...
    sysctls:
      - fs.inotify.max_user_watches=524288
      - fs.inotify.max_user_instances=256
```

Or on the Proxmox host:
```bash
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

---

### Issue #12: WS Reconnection Strategy

**Needed but not for M1.** Browser tab loses connection → agents freeze.

**Fix (implement in M3):**

```typescript
// useWebSocket.ts
function connect() {
  const ws = new WebSocket(url);

  ws.onclose = () => {
    console.log('J.O.B.S.: Disconnected, reconnecting in 3s...');
    useOfficeStore.setState({ connected: false });
    setTimeout(connect, 3000); // Exponential backoff in production
  };

  ws.onopen = () => {
    useOfficeStore.setState({ connected: true });
    // Server sends snapshot automatically on connect (Issue #8)
  };
}
```

---

## Revised M1 Scope (Per Devil's Advocate Recommendations)

### Cuts for M1:
- **No A* pathfinding** — use direct linear interpolation (lerp between positions). Add A* in M2.
- **4 event types only:** `session.started`, `tool.*` (any tool), `activity.thinking`, `session.ended`
- **Skip:** coffee machine routing, library station, sub-agent spawning, audio
- **Add:** Empty office state ("No active sessions — waiting for Claude Code activity...")

### M1 Deliverable Checklist:
- [ ] Vite + React 19 + PixiJS v8 + @pixi/react v8 scaffold
- [ ] Disable React Strict Mode
- [ ] Extract 5 bridge core files, adapt for chokidar v5 (filter, no glob)
- [ ] Simple WS server with snapshot on connect
- [ ] Session manager with UUID file detection + ghost timeout
- [ ] Basic office canvas: floor + 4 desks + whiteboard + terminal + door
- [ ] 1 ai-town sprite with walk animation + faked sitting/idle
- [ ] Event → state → position mapping (4 event types)
- [ ] Linear interpolation movement between stations
- [ ] Empty office state with "Waiting..." message
- [ ] `J.O.B.S. ONLINE` / `OFFLINE` connection indicator

---

## Updated Tech Stack

| Component | Before (VISION.md) | After (Corrected) |
|---|---|---|
| React | 18 | **19** |
| @pixi/react | v8 | v8 (confirmed compatible) |
| PixiJS | v8 | v8 (confirmed) |
| chokidar | v4.x | **v5 with ignored filter** (no globs) |
| Pathfinding (M1) | A* (pathfinding npm) | **Linear interpolation** (add A* in M2) |
| Strict Mode | default | **Disabled** (pixi-react Issue #602) |
| Bridge files | ~4 | **5** (watcher, parser, adapter, events, types) |
| Session tracking | extracted from bridge | **Custom session-manager.ts** |
