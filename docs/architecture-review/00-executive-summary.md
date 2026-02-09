# 00 — Executive Summary

### J.O.B.S. Architecture Review — Pre-M1 Pressure Test

**Date:** February 8, 2026
**Reviewers:** Frontend Engineer, Backend Architect, Devil's Advocate
**Document Under Review:** VISION.md (v0.1.0)

---

## Verdict

**The architecture is sound.** The core decisions — PixiJS over Phaser, Zustand for state, native WebSocket, single Docker container, event-to-behavior mapping — are all validated. No fundamental rethink is needed.

**However, 10 specific issues must be addressed before M1 starts.** Two are blocking (React version mismatch, chokidar glob removal). The rest are high-priority design gaps that will cause confusion or wasted effort if discovered mid-implementation.

---

## Blocking Issues (2)

| # | Issue | Impact |
|---|---|---|
| 1 | **@pixi/react v8 requires React 19**, not React 18 | Nothing renders. Must update VISION.md. |
| 2 | **chokidar v4 dropped glob support** | `**/*.jsonl` pattern won't work natively. Pin v3 or add glob library. |

## High-Priority Design Gaps (6)

| # | Issue | Impact |
|---|---|---|
| 3 | Bridge extraction is 5 files, not ~4 | Underestimated scope; session.ts should NOT be extracted |
| 4 | JSONL files are UUID-named, not `session.jsonl` | Event flow diagram is wrong |
| 5 | ai-town sprites need format conversion + only have walk cycles | Must write converter script; sitting/typing animations must be faked |
| 6 | Privacy stripping misses `cwd`, `gitBranch`, tool results, URLs | Data leaks in v1 if not fixed |
| 7 | Session lifecycle edge cases unaddressed | Crashed sessions leave ghost agents; no startup recovery |
| 8 | No state snapshot on WS connect | Second browser tab sees empty office |

## Medium-Priority Items (4)

| # | Issue | Impact |
|---|---|---|
| 9 | Zustand-PixiJS bridge pattern undocumented | Risk of React reconciliation bottleneck |
| 10 | WebGL context loss handling missing | Dashboard freezes after GPU pressure events |
| 11 | inotify limits undocumented for Proxmox | Silent file-watch failures in production |
| 12 | WS reconnection strategy unspecified | Disconnected clients stay broken |

## M1 Scope Assessment

M1 as written is **achievable but tight** for 1-2 sessions. Recommended cuts:
- Replace A* pathfinding with direct linear interpolation (add A* in M2)
- Limit to 4 event types (started, tool.*, thinking, ended) — skip coffee machine, library, sub-agents
- The empty office state (0 sessions) must be designed — it's the default view

## Top 3 Momentum Killers

1. **Sprite sheet format conversion** — ai-town TypeScript format → PixiJS JSON atlas
2. **JSONL format mapping** — Raw tool names (`Write`, `Bash`) ≠ bridge event types (`tool.file_write`)
3. **@pixi/react dev quirks** — Strict mode crash (Issue #602) wastes debugging time

---

## Reports

- [01 — Frontend Architecture Review](./01-frontend-architecture.md)
- [02 — Backend & Infrastructure Review](./02-backend-infrastructure.md)
- [03 — Scope & Risk Assessment](./03-scope-and-risks.md)
- [04 — Recommended VISION.md Changes](./04-recommended-changes.md)
