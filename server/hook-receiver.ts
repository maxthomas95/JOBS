import { Router } from 'express';
import { basename } from 'node:path';
import type { SessionManager } from './session-manager.js';
import type { WSServer } from './ws-server.js';
import { safeString } from './sanitize.js';

const ALLOWED_HOOK_EVENTS = new Set([
  'Stop', 'SubagentStart', 'SubagentStop',
  'SessionStart', 'SessionEnd',
  'Notification', 'PermissionPrompt',
  'PreToolUse', 'PostToolUse', 'PreCompact',
  'TeammateIdle', 'TaskCompleted',
]);

export function createHookRouter(sessionManager: SessionManager, wsServer: WSServer, token: string | null = null): Router {
  const router = Router();

  router.post('/api/hooks', (req, res) => {
    try {
      // Auth check — always return 200 to never block Claude
      if (token) {
        const authHeader = req.headers.authorization;
        const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (headerToken !== token) {
          res.status(200).json({ ok: true });
          return;
        }
      }

      const body = req.body as Record<string, unknown>;
      const sessionId = safeString(body.session_id, 128);
      const hookEventName = safeString(body.hook_event_name, 64);

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
      const machineId = typeof body.machine_id === 'string' ? body.machine_id : undefined;
      const machineName = typeof body.machine_name === 'string' ? body.machine_name : undefined;

      // Strip sensitive fields
      if (typeof body.cwd === 'string') {
        body.cwd = basename(body.cwd);
      }
      if (typeof body.transcript_path === 'string') {
        body.transcript_path = basename(body.transcript_path);
      }
      delete body.machine_id;
      delete body.machine_name;

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
