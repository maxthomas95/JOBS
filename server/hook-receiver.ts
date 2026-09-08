import { Router } from 'express';
import type { SessionManager } from './session-manager.js';
import type { WSServer } from './ws-server.js';
import { safeString, safeBasename, safeIdentifier } from './sanitize.js';
import { requireBearer } from './auth.js';

const ALLOWED_HOOK_EVENTS = new Set([
  'Stop', 'SubagentStart', 'SubagentStop',
  'SessionStart', 'SessionEnd',
  'Notification', 'PermissionPrompt',
  'PreToolUse', 'PostToolUse', 'PreCompact',
  'TeammateIdle', 'TaskCompleted',
]);

export function createHookRouter(sessionManager: SessionManager, wsServer: WSServer, token: string | null = null): Router {
  const router = Router();

  router.post('/api/hooks', requireBearer(token), (req, res) => {
    try {
      const input = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = safeIdentifier(input.session_id);
      const hookEventName = safeString(input.hook_event_name, 64);

      if (!sessionId || !hookEventName) {
        res.status(200).json({ ok: true });
        return;
      }

      // Reject unknown hook events silently
      if (!ALLOWED_HOOK_EVENTS.has(hookEventName)) {
        res.status(200).json({ ok: true });
        return;
      }

      // Extract machine info before stripping
      const machineId = safeIdentifier(input.machine_id, 64) ?? undefined;
      const machineName = safeString(input.machine_name, 64) ?? undefined;
      const body: Record<string, unknown> = {
        session_id: sessionId, hook_event_name: hookEventName,
        cwd: safeBasename(input.cwd), project: safeBasename(input.project),
        agent_id: safeIdentifier(input.agent_id), agent_type: safeIdentifier(input.agent_type, 64),
        tool_name: input.notification_type === 'permission_prompt' || input.tool_name === 'permission_prompt'
          ? 'permission_prompt' : safeIdentifier(input.tool_name),
      };

      const hasSession = sessionManager.hasSession(sessionId);
      // eslint-disable-next-line no-console
      console.log(`[hooks] ${hookEventName} for session ${sessionId.slice(0, 12)}… (known=${hasSession})`);

      const event = sessionManager.handleHookEvent(hookEventName, body, {
        machineId: machineId,
        machineName: machineName,
      });
      if (event) {
        wsServer.broadcast(event);
        wsServer.broadcastSnapshot();
      } else if (hasSession) {
        // Hook was handled but didn't produce a broadcast event — still snapshot
        wsServer.broadcastSnapshot();
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[hooks] error:', (err as Error).message);
      // Always return 200 to never block Claude
      res.status(200).json({ ok: true });
    }
  });

  return router;
}
