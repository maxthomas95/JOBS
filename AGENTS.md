# Working on J.O.B.S.

J.O.B.S. (Jarvis Operations & Bot Surveillance) is a self-hosted browser office
that visualizes coding-agent activity. Keep its pixel-art identity and make the
surrounding controls useful for monitoring several sessions.

## Start here

- Read `README.md` for setup and `CONTRIBUTING.md` for contribution conventions.
- `VISION.md` contains design decisions, shipped milestones, and future ideas.
  Unchecked roadmap items are proposals, not implemented functionality.
- `CLAUDE.md` is the existing Claude Code guide. This file provides the shared
  working rules in Codex's `AGENTS.md` format.
- Read `docs/reviews/2026-09-07.md` for the return-to-project review, verified
  problems, Codex integration options, and UI priorities. Findings are dated;
  check the current code before treating them as unresolved.
- `docs/architecture-review/` is a February 2026 design review;
  `docs/v2-m7-audit.md` is a historical stabilization checklist. Checked boxes
  are not a substitute for current regression checks.

## Git workflow

- Use remote `github` (`maxthomas95/JOBS`). GitHub is the source of truth.
- Never develop, commit, or push directly on `main`. Use a focused branch.
- Prefer a separate worktree for substantial work, preserving the user's active
  checkout. Inspect status and compare with `github/main` before choosing a base.
- Stage only task files. Preserve unrelated edits, `.env`, local data, and assets.
- Use conventional commit subjects. PR descriptions follow
  `.github/pull_request_template.md`: summary, test plan, out of scope.
- Changes land through PR and squash merge; check actual CI results when publishing.

## Architecture

- React 19 + TypeScript + Zustand 5 provide the UI and application state.
- PixiJS 8 uses its imperative API, not a React Pixi wrapper. `PixelOffice` owns
  renderer initialization; `AnimationController` bridges store changes to sprites.
- Express + native `ws` serve the production frontend and WebSocket endpoint.
- Claude JSONL -> watcher -> parser/adapter -> session manager -> normalized
  event/snapshot -> WebSocket -> Zustand -> animation/UI.
- Claude hooks supplement the watcher. Generic webhooks create external agents.
- Codex lifecycle hooks normalize through `server/codex-provider.ts`; legacy
  `notify` remains completion-only. See `docs/codex.md` for supported events,
  trust/setup, diagnostics, and limits. A badge does not imply provider parity.
- `src/types/agent.ts` and `src/types/events.ts` are shared with the server.
  Browser and server modules run in separate processes; mutating client map
  configuration does not update the server's station capacity.

## Commands and verification

Use Node 22 to match CI and Docker. Commit the npm lockfile with intentional
dependency changes. Avoid broad lockfile updates during unrelated work.

```powershell
npm ci
npm run dev
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

`npm run build` runs TypeScript project builds for the client/config and server.
Root `npx tsc --noEmit` alone is not a replacement: root `tsconfig.json` has an
empty files list and project references. `npm test` uses Node's test runner and
tsx for synthetic regression fixtures under `tests/`. Keep tests isolated from
the user's actual home/configuration, transcripts, stats, and running sessions.

For isolated visual checks in PowerShell:

```powershell
$env:MOCK_EVENTS = 'multi'  # also true, supervisor, webhook
$env:PORT = '18780'
$env:STATS_FILE = '.playwright-mcp/review/stats.json'
npm run build
npm start
```

Open `http://localhost:18780` to exercise the production frontend and CSP.
Use a separate process/worktree so mock events do not affect real session stats.
Default development is Vite 5173 + backend 8780. Vite proxies the configured
`PORT` and `WS_PATH`; the browser uses the same origin in development/production.

## Assets and UI checks

- Purchased LimeZu tiles are ignored under `src/assets/tiles/`. Do not commit them.
- `npm run assets` fetches the optional tiles from an authenticated private repo
  (`JOBS_ASSETS_REPO` override). The procedural fallback must still work without them.
- Inspect the production build as well as Vite when changing rendering or CSP.
- Keep `src/main.tsx`'s `pixi.js/unsafe-eval` compatibility import. Do not infer
  from its name that the server should enable CSP `unsafe-eval`.
- Check desktop and narrow layouts, selected-agent details, reconnect/empty
  states, and keyboard operation. Keep pixel art crisp and its aspect ratio fixed.

## Privacy and scope

- Treat transcripts, prompts, assistant text, tool inputs/outputs, credentials,
  full paths, search patterns, and raw commands as sensitive server-side data.
- Build browser payloads from an explicit allowlist of metadata. A type annotation,
  object spread, basename on the wrong OS, or truncated string is not redaction.
- Use synthetic fixtures to check event ingestion. Do not put real transcripts,
  tokens, private asset files, or runtime stats into documentation or tests.
- `JOBS_TOKEN` enables viewer sign-in with a server-managed HttpOnly cookie.
  Hook senders use bearer credentials. Generic webhooks inherit `JOBS_TOKEN`
  unless `WEBHOOK_TOKEN` is configured. Never place tokens in HTML or URLs.
- Loopback is the default bind/publish address. Network hosts require
  `ALLOWED_HOSTS`; HTTPS proxies should preserve Host/Origin and set
  `COOKIE_SECURE=true`. See README for deployment configuration.
- Hook installers mutate user-level configuration. During tests use an isolated
  home/config directory; preserve existing integrations and never run setup against
  the user's actual configuration merely to review it.
- For Codex feature work, verify current official documentation and the installed
  version. Prefer supported hooks for passive monitoring; app-server is a deeper
  integration choice. Session transcripts are not a stable public event API.
