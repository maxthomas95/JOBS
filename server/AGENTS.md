# Server guidance

The root `AGENTS.md` applies here.

- Keep parsing, provider normalization, lifecycle state, and transport separate.
  Preserve the native WebSocket protocol unless a task deliberately changes it.
- Treat `PixelEvent` and snapshots as public data. Explicitly serialize allowed
  fields; do not spread internal `ServerAgent` objects into browser payloads.
  `filePath`, transcript content, and provider tool input must stay server-side.
- Normalize Windows and Unix separators when deriving safe display basenames.
  String truncation validates size but does not sanitize secrets.
- JSONL offsets are byte offsets. Buffer incomplete records, preserve UTF-8
  boundaries, and serialize reads per file. Check Unicode, partial writes,
  truncation, restart, and duplicate delivery when changing the watcher.
- Provider session IDs, turn IDs, and tool-call IDs need stable identities.
  Correlate parent/child events explicitly and tolerate events arriving out of order.
- Timed removal must verify the same session generation is still leaving.
  Repeated start/stop, resurrection, and snapshots must agree on lifecycle state.
- Server desk allocation and both renderers use `src/types/office-layout.ts`.
  Keep station and access-lane changes shared, with reachability regression checks.
- `WEBHOOK_TOKEN` optionally separates generic ingestion from `JOBS_TOKEN`. Check
  HTML, stats, WebSocket, hooks, and generic webhooks together for auth changes.
- Keep notify delivery bounded and non-blocking for normal agent work. Surface
  setup/health failures through diagnostics rather than swallowing every failure.
- `setup-hooks.js` changes files in the user's home. Test it using temporary
  configuration, including existing notify commands and multiline TOML.
- Existing hooks are Claude-specific despite similar event names. A new Codex
  adapter needs explicit provider identity and its own normalization, rather than
  routing Codex payloads blindly into Claude session registration.
- Use `npm run build` for the server TypeScript build and `npm test` for synthetic
  Node/tsx regressions. Close server/watcher/session/stats resources in fixtures.
