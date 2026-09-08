# Frontend guidance

The root `AGENTS.md` applies here.

- Keep Pixi rendering imperative. React owns controls; Zustand communicates
  session state to `AnimationController` and `AgentSpriteManager`.
- Clean up subscriptions, timers, animation frames, textures, audio, and async
  initialization on unmount. Do not add React StrictMode without checking Pixi's
  initialization and destruction paths.
- Reconnect snapshots replace the authoritative roster. Reconcile histories,
  tool timing, selection, follow state, and leaving timers when agents disappear.
- Provider badge, state, and capability are separate concepts. A Codex agent
  marked waiting must participate in input-needed sorting/notifications; do not
  fabricate tool metrics from completion-only notifications.
- Share labels/colors through `ui/stateLabels.ts` and theme tokens through
  `themes.ts`. Use readable sentence-case UI text; reserve monospace for code
  identifiers, filenames, and timestamps where it helps.
- Retain the pixel office and mascots. Modernization should improve the control
  layout and session comprehension, with a separate kiosk experience if desired.
- Use real buttons for selectable agents/groups, with accessible names and
  selection/expanded states. Provide visible focus and appropriate Escape behavior.
- Respect reduced motion in both CSS and Pixi. Keep text/status available outside
  canvas; color and animation alone should not carry state.
- Preserve the 4:3 world aspect ratio on mobile. Panels should reserve space or
  use an intentional drawer; avoid overlapping translucent controls over the office.
- Validate production CSP, optional tileset fallback, desktop/narrow layouts, and
  populated/empty/disconnected states. Use mock events and isolated stats.
- `docs/reviews/2026-09-07-ui-concept.html` is a standalone design proposal with
  synthetic data, not an implemented product feature or connected dashboard.
