# 02 — Backend & Infrastructure Architecture Review

**Reviewer:** Backend & Infrastructure Architect
**Date:** February 8, 2026

---

## 1. Bridge Extraction from pixelhq-bridge

**Finding: Extraction is feasible but not as clean as "~4 files."**

The pixelhq-bridge repo (github.com/waynedev9598/pixelhq-bridge) has this src/ structure:

```
src/
  index.ts          # Bridge orchestrator
  config.ts         # Configuration + CLI args
  logger.ts         # Centralized logger
  watcher.ts        # chokidar file watcher         <-- EXTRACT
  parser.ts         # JSONL parsing                  <-- EXTRACT
  adapters/
    claude-code.ts  # Privacy-stripping adapter      <-- EXTRACT
  pixel-events.ts   # Event factories               <-- EXTRACT
  session.ts        # Session tracking + agent state <-- EXTRACT
  auth.ts           # Device pairing (Bonjour)       skip
  websocket.ts      # WebSocket server               skip (write our own)
  bonjour.ts        # mDNS advertisement             skip
  typed-emitter.ts  # Type-safe EventEmitter         may need
  types.ts          # TypeScript definitions          <-- EXTRACT
```

**Issues:**
- VISION.md says "~4 files" but you actually need **6-7 files**: watcher, parser, claude-code adapter, pixel-events, session, types, and potentially typed-emitter.
- `session.ts` is a dependency tangle risk — it handles agent state tracking which overlaps with the planned `session-manager.ts`. You need to decide: extract session.ts as-is, or rewrite session management from scratch using only the lower-level watcher+parser+adapter.
- The `index.ts` orchestrator wires everything together with config, auth, and bonjour. You cannot use it directly — you must write your own orchestrator.
- `logger.ts` is used throughout — either extract it or replace with console/pino.

**Recommendation:** Extract watcher.ts, parser.ts, adapters/claude-code.ts, pixel-events.ts, and types.ts (5 files). Write your own session-manager.ts from scratch rather than adapting session.ts, since J.O.B.S. has different lifecycle requirements (multi-agent desk assignment, sprite mapping). Replace the typed-emitter with standard Node EventEmitter or a lightweight alternative. Update VISION.md to say "~5 files" and list them explicitly.

---

## 2. chokidar Inside Docker (CRITICAL)

**Finding: inotify events DO propagate on Linux-to-Linux bind mounts, but with caveats.**

The VISION.md docker-compose mounts `${HOME}/.claude:/data/claude:ro`. The key question: will chokidar detect when Claude Code appends to JSONL files from the host?

**Good news:** On native Linux Docker (which Proxmox uses), inotify events DO propagate from host to container for bind mounts. Unlike Docker Desktop on Mac/Windows (which uses a VM layer that breaks inotify), native Linux Docker shares the kernel, so filesystem events work.

**Risks and mitigations:**

| Risk | Impact | Mitigation |
|------|--------|------------|
| inotify watch limit exhaustion | Container silently stops detecting changes | Set `fs.inotify.max_user_watches=524288` on the Proxmox **host** (cannot be set inside container). Add this to deployment docs. |
| chokidar v4 removed glob support | Pattern `**/*.jsonl` won't work natively | chokidar v4 dropped built-in glob. You need to either (a) use chokidar v3 which bundles glob, or (b) use chokidar v4 with a separate glob library to find files, then watch them individually. Check what pixelhq-bridge pins. |
| Read-only mount + atomic writes | Some editors do atomic write (write temp, rename). Claude Code does append-only, so this should be fine. | Verify Claude Code actually appends rather than rewriting. The append-only pattern is confirmed by pixelhq-bridge docs. |
| New session files appearing | chokidar must detect NEW .jsonl files, not just changes to existing ones | Watch the parent directory with `depth: Infinity` or re-scan periodically. |

**Recommendation:** Add a `CHOKIDAR_USEPOLLING=false` env var as documentation (it's the default on Linux, but makes it explicit). Add inotify limit instructions to the deployment README. Pin chokidar version carefully — if using v4, handle glob removal. Add a health check that verifies the watcher is receiving events.

---

## 3. Claude Code JSONL Format

**Finding: The format is well-documented but more complex than VISION.md implies.**

**Directory structure:**
```
~/.claude/
  projects/
    -Users-maxthomas-myproject/    # Path-encoded (/ and . become -)
      {uuid}.jsonl                 # One file per conversation session
    -Users-maxthomas-other-project/
      {uuid}.jsonl
  history.jsonl                    # Master index mapping paths to sessions
```

**JSONL line structure (each line):**
```json
{
  "parentUuid": "...",
  "sessionId": "...",
  "version": "...",
  "gitBranch": "main",
  "cwd": "/Users/maxthomas/myproject",
  "message": {
    "role": "user | assistant",
    "content": [
      { "type": "text", "text": "..." },
      { "type": "tool_use", "name": "Write", "input": {}, "tool_use_id": "..." },
      { "type": "tool_result", "tool_use_id": "...", "content": "..." }
    ]
  },
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 567,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  },
  "uuid": "...",
  "timestamp": "2026-02-08T10:30:00.000Z",
  "toolUseResult": {}
}
```

**Key tool names in content[].name:** Write, Read, Edit, Glob, Grep, LS, MultiEdit, NotebookRead, NotebookEdit, WebFetch, WebSearch, Bash, TodoRead

**Issues for VISION.md:**
- The glob pattern `**/*.jsonl` is correct, but file names are UUIDs (e.g., `a1b2c3d4-e5f6.jsonl`), not `session.jsonl` as shown in the event flow diagram.
- The `cwd` field contains the full project working directory — this is sensitive and must be stripped.
- The `gitBranch` field could leak repository information.
- Tool inputs contain full file paths, code content, bash commands — all present in `message.content[].input`.
- The event type mapping in VISION.md (e.g., `tool.file_write`, `activity.thinking`) are **bridge event types**, not raw JSONL types. The adapter must map from raw JSONL tool names (`Write`, `Read`, `Bash`, `Grep`) to these bridge event types.

**Recommendation:** Update the event flow diagram to show UUID-named files. Document the mapping from raw JSONL tool names to bridge event types explicitly. Ensure the adapter strips `cwd`, `gitBranch`, and all `input` fields from tool_use blocks.

---

## 4. Single Container: Express + ws on Same Port

**Finding: This is a well-established pattern with no significant issues.**

The `ws` library is designed to work with Node's `http.Server`. The standard pattern:

```typescript
const server = http.createServer(app); // Express
const wss = new WebSocket.Server({ server }); // Shares the HTTP server
server.listen(8780);
```

The HTTP upgrade mechanism is handled automatically by `ws`. When a client sends an `Upgrade: websocket` header, Node's http server emits an `upgrade` event which `ws` intercepts. Normal HTTP requests continue to Express for static file serving.

**Production considerations:**
- Connection limits: Node's default `server.maxConnections` is unlimited. For a self-hosted tool with a handful of browser tabs, this is fine.
- No path conflict: You can namespace the WebSocket to `/ws` to avoid any ambiguity.
- Memory: Each WebSocket connection uses ~20-50KB. Even with 100 browser tabs, this is trivial.
- No reverse proxy needed for v1. If a reverse proxy (nginx/Traefik) is added later, it must be configured to forward WebSocket upgrade headers.

**Recommendation:** No changes needed. This design is solid for the use case. Consider namespacing WebSocket to a specific path (e.g., `/ws`) for clarity and future reverse proxy compatibility.

---

## 5. WebSocket Reconnection Strategy

**Finding: VISION.md defers reconnection to M5 but the architecture should account for it from M1.**

**Recommended pattern:**

```
Initial delay: 1 second
Backoff: exponential (1s, 2s, 4s, 8s, 16s, 30s cap)
Jitter: +/- 20% randomization to prevent thundering herd
Max retries: unlimited (this is a dashboard, it should always reconnect)
Reset: on successful connection
```

**State sync on reconnect is the harder problem.** When a browser reconnects after being offline for 30 seconds, what state does it need?

Options:
1. **Full state snapshot on connect** (recommended for v1): When a WebSocket connects, the server sends the complete current state (all active agents, their current states, desk assignments). Simple, reliable, small payload.
2. **Event replay with sequence numbers** (v2): Server assigns monotonic sequence numbers. Client sends last-seen sequence on reconnect. Server replays missed events. More complex, better for long disconnections.

**Recommendation:** Implement option 1 for M1. When a client connects/reconnects, the server sends a `state.snapshot` message with all current agent states. This is simple and handles 100% of reconnection scenarios. Add `lastEventId` tracking as a v2 enhancement. Also implement application-level ping/pong heartbeats (every 30s) to detect dead connections faster than TCP keepalive.

---

## 6. Session Lifecycle Edge Cases

**Finding: Several edge cases need explicit handling. VISION.md does not address any of them.**

| Edge Case | What Happens | Recommended Handling |
|-----------|-------------|---------------------|
| Claude Code crashes mid-session | JSONL file stops receiving appends. No explicit "session ended" event. | Implement a **staleness timer**: if no new events for 5 minutes, transition agent to `idle`. After 15 minutes, transition to `leaving` and free the desk. |
| Session file deleted while being watched | chokidar emits `unlink` event | Treat as session end. Transition agent to `leaving`. Free desk. |
| Watcher starts with existing active sessions | JSONL files already exist with recent timestamps | On startup, scan all existing JSONL files. Parse the last N lines (e.g., 50) to determine current state. If last event was < 15 minutes ago, create agent in appropriate state. |
| Multiple JSONL files for same project | Claude Code creates a new UUID file per conversation | Each JSONL file = one agent. Map by file path, not by project path. |
| Agent spawns sub-agent | Claude Code tool `task` or agent orchestration creates child sessions | Sub-agents get their own JSONL files. The `spawn_agent` event in the parent links to the child. Assign a new character sprite. |
| Session file grows very large | Long-running sessions can produce 10MB+ JSONL files | Only track file offset (seek to end on start, read only new lines). Never re-read the entire file. pixelhq-bridge already does this — the watcher tracks byte offsets. |
| Rapid event bursts | Claude Code can emit many tool calls per second | Debounce/throttle state changes to max 2-3 per second for animation smoothness. Buffer events and batch-broadcast. |

**Recommendation:** Add a "Session Lifecycle" section to VISION.md documenting these edge cases. The staleness timer is the most important — without it, crashed sessions will leave ghost agents sitting at desks forever. Implement file offset tracking from day 1 (don't read from beginning of file).

---

## 7. Privacy Stripping

**Finding: The VISION.md approach is incomplete. Several additional fields leak sensitive data.**

**Currently planned to strip (per VISION.md):**
- File paths → basename only
- Code content → stripped entirely
- Bash commands → description only
- Thinking/responses → stripped

**Additional fields that MUST be stripped:**

| Field | Location | Risk | Action |
|-------|----------|------|--------|
| `cwd` | Top-level JSONL | Leaks full project directory path | Strip entirely or basename only |
| `gitBranch` | Top-level JSONL | Leaks branch name (may contain ticket numbers, feature names) | Strip or keep as-is (debatable — branch names are low-risk) |
| `message.content[].input` (tool_use) | Content array | Contains full file paths, code, bash commands, search queries, URLs | Strip per tool type: Read/Write/Edit → basename only; Bash → strip command; Grep/Glob → strip pattern; WebFetch → strip URL |
| `message.content[].content` (tool_result) | Content array | Contains file contents, command output, search results | Strip entirely |
| `parentUuid`, `sessionId`, `uuid` | Top-level | Could be used to correlate sessions | Keep for internal tracking but don't broadcast raw |
| `usage` (token counts) | Top-level | Low risk but reveals session intensity | Keep — useful for office visualization (show "busy" indicator) |
| Search queries (`Grep`/`Glob` patterns) | tool_use input | Could reveal codebase structure | Strip pattern, keep tool type only |
| `WebFetch` / `WebSearch` URLs | tool_use input | Could reveal internal URLs, API endpoints | Strip entirely |
| Error messages | tool_result with errors | Could contain file paths, stack traces | Strip to generic "error occurred" |

**The pixelhq-bridge adapter uses an explicit allowlist approach** — only whitelisted fields pass through. This is the correct approach (deny-by-default). The VISION.md should specify this pattern explicitly.

**Recommendation:** Adopt the allowlist pattern from pixelhq-bridge. For each tool type, define exactly which fields are broadcast. The default for any unrecognized field is "strip." Add privacy tests that feed mock JSONL with sensitive data through the pipeline and assert none leaks out. Add `cwd` and `gitBranch` to the strip list. Decide whether to strip or keep `gitBranch` (strip for v1, make configurable later).

---

## Summary: Changes Before M1

| Priority | Change |
|----------|--------|
| **BLOCKING** | Handle chokidar v4 glob removal — pin v3 or add glob library |
| **HIGH** | Update bridge file count: "~4 files" → "5 core files" + write own session-manager |
| **HIGH** | Fix JSONL file naming in docs: files are `{uuid}.jsonl`, not `session.jsonl` |
| **HIGH** | Add staleness timer for crashed sessions: 5-min idle, 15-min eviction |
| **HIGH** | Expand privacy stripping list: add `cwd`, `gitBranch`, tool_result content, URLs, errors |
| **HIGH** | Implement state snapshot on WS connect |
| **HIGH** | Track file byte offsets: only read new appended lines |
| **MEDIUM** | Add inotify limit documentation for Proxmox host |

**Architecture is sound overall.** The single-container Express+ws design, the bridge extraction approach, and the event-to-behavior mapping are all solid foundations. The main risks are in the Docker file-watching details and privacy completeness.
