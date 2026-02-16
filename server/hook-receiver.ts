import { Router } from 'express';
import { basename } from 'node:path';
import type { SessionManager } from './session-manager.js';
import type { WSServer } from './ws-server.js';

export function createHookRouter(sessionManager: SessionManager, wsServer: WSServer): Router {
  const router = Router();

  router.post('/api/hooks', (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const sessionId = body.session_id as string | undefined;
      const hookEventName = body.hook_event_name as string | undefined;

      if (!sessionId || !hookEventName) {
        res.status(400).json({ ok: false, error: 'session_id and hook_event_name are required' });
        return;
      }

      // Strip sensitive fields
      if (typeof body.cwd === 'string') {
        body.cwd = basename(body.cwd);
      }
      if (typeof body.transcript_path === 'string') {
        body.transcript_path = basename(body.transcript_path);
      }

      const hasSession = sessionManager.hasSession(sessionId);
      // eslint-disable-next-line no-console
      console.log(`[hooks] ${hookEventName} for session ${sessionId.slice(0, 12)}… (known=${hasSession})`);

      const event = sessionManager.handleHookEvent(hookEventName, body);
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
