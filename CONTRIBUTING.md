# Contributing to J.O.B.S.

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/maxthomas95/JOBS.git
cd JOBS
npm install
npm run dev
```

This starts the Vite dev server (port 5173) and the backend (port 8780).

To test without real Claude Code sessions:

```bash
MOCK_EVENTS=true npm run dev:server    # Single agent
MOCK_EVENTS=supervisor npm run dev:server  # Team scenarios
```

## Making Changes

1. Fork the repository and create a feature branch
2. Make your changes
3. Run the checks:
   ```bash
   npm run lint      # ESLint
   npx tsc --noEmit  # Type checking
   npm run build     # Full build
   ```
4. Open a pull request with a clear description

## Code Style

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **ESLint** — `npm run lint` must pass with zero errors
- **Imperative PixiJS** — no React wrappers for PixiJS, use the imperative API directly
- **Privacy first** — never expose code content, full file paths, or sensitive data to the browser

## Project Structure

- `server/` — Node.js backend (Express + WebSocket + file watching)
- `src/engine/` — PixiJS rendering (sprites, pathfinding, animations)
- `src/state/` — Zustand stores
- `src/ui/` — React HUD overlay
- `src/audio/` — Howler.js sound management

## Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Browser and OS info
- Console errors (if any)

## Questions?

Open a discussion or issue — happy to help!
