# v2-M7 Stabilization & Polish — Audit Findings

> Generated 2026-02-18 by 3-agent parallel audit (perf, UX, stress testing).
> 38 unique issues found, deduplicated across agents.

---

## Critical — Bugs that cause incorrect behavior

- [ ] **1. Stale setTimeout evicts resurrected agents** — server `evictSession` fires 3s after entering 'leaving' state even if the agent re-registered during that window. Same pattern in waiting detector and entering timeout.
  - `server/session-manager.ts:874-896`
  - Fix: Check agent is still in expected state inside the setTimeout callback before evicting.

- [ ] **2. Client-side stale setTimeout removes re-added agents** — when `session.ended` arrives, a 2s timeout schedules `removeAgent()`. If the same session re-registers (resurrection), the stale timeout removes the newly re-added agent.
  - `src/state/useOfficeStore.ts:284-286`
  - Fix: Store timeout ID per agent, cancel on re-registration.

- [ ] **3. Tab wake deltaSeconds spike** — PixiJS ticker `deltaMS` equals the entire sleep duration on tab wake, causing agents to overshoot their targets wildly (speed * minutes).
  - `src/engine/AnimationController.ts`
  - Fix: Cap `deltaSeconds` to `Math.min(ticker.deltaMS / 1000, 0.1)`.

- [ ] **4. Idle pose position drift** — `sprite.y += Math.sin(...)` accumulates offset each frame instead of applying absolute offset from a fixed base position. Affects all idle states: thinking, terminal, coding, reading, searching, cooling, needsApproval, compacting.
  - `src/engine/AgentSprite.ts:770, 776, 782, 788, 803, 816`
  - Fix: Use `sprite.y = baseY + Math.sin(...)` with stored base position.

- [ ] **5. Stats sessionIndex rebuild uses name instead of sessionId** — after server restart, the index maps by `rec.name` instead of `sessionId`, so `recordSessionEnd(sessionId)` fails to match.
  - `server/stats-store.ts:49-55`
  - Fix: Persist sessionId in records, or rebuild index by sessionId.

---

## High — Memory leaks & performance issues that compound over time

- [ ] **6. agentHistory/toolCounts/toolTime/pendingToolStarts never cleaned on agent removal** — Maps grow unbounded as agents cycle in and out over a long browser session.
  - `src/state/useOfficeStore.ts:164-178`
  - Fix: Delete per-agent entries in `removeAgent()`.

- [ ] **7. agentHistory entries per agent unbounded** — thousands of state changes pile up with no cap. Causes rendering lag in AgentDetailPanel timeline.
  - `src/state/useOfficeStore.ts:193, 333`
  - Fix: Cap history entries per agent (e.g., keep last 200).

- [ ] **8. toolNameCache grows unbounded** — orphaned entries (tool_use with no tool_result) never expire. Accumulates over weeks.
  - `server/bridge/claude-adapter.ts:10`
  - Fix: Periodic cleanup or LRU cap (~500 entries).

- [ ] **9. hookPendingChildren never expires** — no TTL cleanup if child session never registers.
  - `server/session-manager.ts:134`
  - Fix: Add TTL-based cleanup like archivedAgents.

- [ ] **10. No exponential backoff on WS reconnect** — fixed 3s retry hammers a struggling server indefinitely.
  - `src/hooks/useWebSocket.ts:55-56`
  - Fix: Exponential backoff (3s, 6s, 12s, 24s, cap at 60s), reset on success.

- [ ] **11. Multiple set() calls per event** — up to 3 separate `set()` calls per WebSocket message, each triggering subscriber notifications. WS messages arrive outside React's batching.
  - `src/state/useOfficeStore.ts:330-370`
  - Fix: Combine all state changes into a single `set()` call.

- [ ] **12. No snapshot broadcast throttling** — every state change broadcasts full snapshot to all clients. With 10+ agents and frequent events, dozens of broadcasts per second.
  - `server/ws-server.ts:42-55`
  - Fix: Throttle `broadcastSnapshot()` to at most once per 200ms.

- [ ] **13. Howl instances never unloaded** — 20-40MB of decoded audio buffers persist even when audio is disabled.
  - `src/audio/AudioManager.ts:34-53`
  - Fix: Call `.unload()` on disable, re-preload on enable.

- [ ] **14. readFile reads entire JSONL into memory** — large session files (hundreds of MB) cause memory spikes on every change event.
  - `server/bridge/watcher.ts:123`
  - Fix: Use `fs.open` + `fs.read` with start offset, or `createReadStream({ start })`.

- [ ] **15. Agent list hard-capped at 10** — `.slice(0, 10)` silently drops agents while the count badge shows the real total, creating a confusing mismatch.
  - `src/ui/HUD.tsx:163`
  - Fix: Remove the cap, add scrollability to the agent list instead.

---

## Medium — UX paper cuts

- [ ] **16. No scrollability on agent list** — no `max-height` or `overflow-y: auto`, overflows viewport with many agents.
  - `src/App.css:132-141`

- [ ] **17. No scrollability on detail panel** — fixed `width: 220px` but no `max-height`/overflow, extends beyond viewport.
  - `src/App.css:398-410`

- [ ] **18. Hardcoded colors break themes** — multiple elements use hardcoded colors instead of CSS variables:
  - Sprite label: `src/App.css:297` (`#cfd8dc`)
  - Detail link: `src/App.css:567` (`#4fc3f7`)
  - Stats bar fill: `src/App.css:705` (`#4fc3f7`)
  - Close button: `src/App.css:438, 446` (`#999`, `#fff`)
  - Check-in bubble: `src/ui/BubbleOverlay.tsx:232` (inline styles)

- [ ] **19. Theme button shares `.daynight-toggle` class** — can't style independently from actual day/night toggle.
  - `src/ui/HUD.tsx:298`

- [ ] **20. Following + supervisor border conflict** — both apply a 2px left border, only one wins via CSS specificity. No combined style.
  - `src/App.css:917-919, 780-783`

- [ ] **21. Duplicate CSS toggle styles** — 3 identical rulesets for notification/daynight/audio toggles.
  - `src/App.css:313-365`

- [ ] **22. Connection status shows no reconnect indicator** — just "DISCONNECTED" with no feedback that auto-reconnect is in progress.
  - `src/ui/ConnectionStatus.tsx`

- [ ] **23. STATE_LABELS duplicated across 3 files** — StatsPanel copy is missing `entering`, `reading`, `idle`, `leaving`.
  - `src/ui/HUD.tsx:12-27`, `src/ui/AgentDetailPanel.tsx:5-20`, `src/ui/StatsPanel.tsx:5-16`

- [ ] **24. Follow indicator overlaps stats panel on narrow viewports** — both positioned at bottom, no mutual awareness.
  - `src/App.css:843-846, 602-612`

- [ ] **25. Feed item font doesn't match theme font stack** — uses bare `monospace` instead of `'IBM Plex Mono', 'Fira Code', monospace`.
  - `src/App.css:223`

- [ ] **26. No animation on activity feed transitions** — items pop in/out instantly, rapid events feel jarring.
  - `src/ui/HUD.tsx:352-358`

- [ ] **27. follow-btn margin-left conflicts with agent-uptime** — both use `margin-left: auto` in same flex row.
  - `src/App.css:897, 178`

- [ ] **28. No agent state clear on disconnect** — stale agents remain visible until reconnect snapshot arrives.
  - `src/hooks/useWebSocket.ts:49-56`

---

## Low — Minor optimizations & nice-to-haves

- [ ] **29. DayNightCycle redraws overlay every frame** — even when color/alpha unchanged.
  - `src/engine/DayNightCycle.ts:74-82`
  - Fix: Cache previous color/alpha, skip redraw if unchanged.

- [ ] **30. Clock hands redrawn every frame** — only needs update once per second.
  - `src/engine/AmbientEffects.ts:167-199`
  - Fix: Cache last-drawn seconds value.

- [ ] **31. announcedSessions/fileOffsets grow unbounded** — never cleaned for deleted files.
  - `server/bridge/watcher.ts:49-50`

- [ ] **32. pendingSpawns only cleaned from front** — interleaved stale entries survive.
  - `server/session-manager.ts:686-696`
  - Fix: Use `filter()` instead of while-from-front.

- [ ] **33. Pathfinder grid cloned per findPath call** — could cache one clone per frame.
  - `src/engine/Pathfinder.ts:104`

- [ ] **34. Duplicate hasActiveChildren computation** — computed twice per agent per frame.
  - `src/engine/AgentSprite.ts:257, 734`

- [ ] **35. BubbleOverlay rAF runs with no agents** — DOM measurements every frame on empty office.
  - `src/ui/BubbleOverlay.tsx:112-149`

- [ ] **36. No WS maxPayload configured** — default 100MB, should be ~16KB.
  - `server/ws-server.ts:17`

- [ ] **37. No graceful watcher shutdown** — no SIGTERM handler to call `watcher.stop()`.
  - `server/index.ts`

- [ ] **38. Name collision on fallback names** — `Agent-${index}` doesn't check `assignedNames`.
  - `server/session-manager.ts:698-713`

---

## Deferred — Accessibility & mobile (out of scope for M7)

- Zero keyboard accessibility (all `<div onClick>` instead of `<button>`)
- No `aria-label` on any button
- No `:focus-visible` styles
- No mobile/touch support beyond basic 640px breakpoint
- Retro theme `* { font-family: ... !important }` override
- `pointer-events: none` blocks text selection on feed/count elements
