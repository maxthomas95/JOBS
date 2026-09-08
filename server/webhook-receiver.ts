import { Router } from 'express';
import type { SessionManager } from './session-manager.js';
import type { WSServer } from './ws-server.js';
import { safeString, safeUrl, safeEnum, safeBasename, safeIdentifier } from './sanitize.js';
import { sameOrigin, tokenMatches } from './auth.js';

type WebhookEvent = 'start' | 'stop' | 'status' | 'error' | 'heartbeat';
const VALID_EVENTS = new Set<WebhookEvent>(['start', 'stop', 'status', 'error', 'heartbeat']);

export function createWebhookRouter(sessionManager: SessionManager, wsServer: WSServer,
  webhookToken = process.env.WEBHOOK_TOKEN || process.env.JOBS_TOKEN || null): Router {
  const router = Router();

  router.post('/api/webhooks', (req, res) => {
    try {
      if (!sameOrigin(req)) {
        res.status(403).json({ ok: false, error: 'Invalid origin' });
        return;
      }
      // Auth check
      if (webhookToken) {
        const authHeader = req.headers.authorization;
        const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const bodyToken = safeString((req.body as Record<string, unknown>)?.token, 256);
        if (!tokenMatches(headerToken, webhookToken) && !tokenMatches(bodyToken, webhookToken)) {
          res.status(401).json({ ok: false, error: 'Invalid or missing token' });
          return;
        }
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

      // Sanitize all fields
      const sourceId = safeIdentifier(body.source_id, 128);
      const event = safeEnum(body.event, VALID_EVENTS);

      if (!sourceId) {
        res.status(400).json({ ok: false, error: 'source_id is required' });
        return;
      }
      if (!event) {
        res.status(400).json({ ok: false, error: 'Invalid or missing event' });
        return;
      }

      const sourceName = safeString(body.source_name, 64);
      const sourceType = safeString(body.source_type, 64);
      const project = safeBasename(body.project);
      const machine = safeString(body.machine, 64);
      const state = safeString(body.state, 64);
      const activity = sourceType === 'codex'
        ? (state === 'waiting' ? 'Turn complete' : 'Codex activity')
        : safeString(body.activity, 200);
      const url = safeUrl(body.url);

      const agentId = `wh:${sourceId}`;

      // eslint-disable-next-line no-console
      console.log(`[webhook] ${event} from ${sourceName ?? sourceId} (${agentId})`);

      if (event === 'start') {
        sessionManager.registerWebhookAgent(sourceId, {
          sourceName: sourceName ?? undefined,
          sourceType: sourceType ?? undefined,
          project: project ?? undefined,
          machine: machine ?? undefined,
          state: state ?? undefined,
          activity: activity ?? undefined,
          url: url ?? undefined,
        });
        wsServer.broadcastSnapshot();
        res.status(200).json({ ok: true, agentId });
        return;
      }

      if (event === 'status') {
        const agent = sessionManager.updateWebhookAgent(
          agentId,
          state ?? null,
          activity ?? null,
          url ?? null,
        );
        if (!agent) {
          res.status(404).json({ ok: false, error: 'Agent not found. Send start event first.' });
          return;
        }
        wsServer.broadcastSnapshot();
        res.status(200).json({ ok: true });
        return;
      }

      if (event === 'stop') {
        const removed = sessionManager.removeWebhookAgent(agentId);
        if (!removed) {
          res.status(404).json({ ok: false, error: 'Agent not found' });
          return;
        }
        wsServer.broadcastSnapshot();
        res.status(200).json({ ok: true });
        return;
      }

      if (event === 'error') {
        const agent = sessionManager.updateWebhookAgent(agentId, 'error', activity ?? 'Error', url ?? null);
        if (!agent) {
          res.status(404).json({ ok: false, error: 'Agent not found' });
          return;
        }
        wsServer.broadcastSnapshot();
        res.status(200).json({ ok: true });
        return;
      }

      if (event === 'heartbeat') {
        const touched = sessionManager.touchWebhookAgent(agentId);
        if (!touched) {
          res.status(404).json({ ok: false, error: 'Agent not found' });
          return;
        }
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ ok: false, error: 'Unhandled event' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhook] error:', (err as Error).message);
      res.status(500).json({ ok: false, error: 'Internal error' });
    }
  });

  return router;
}
