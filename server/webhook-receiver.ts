import { Router } from 'express';
import type { SessionManager } from './session-manager.js';
import type { WSServer } from './ws-server.js';

interface WebhookPayload {
  source_id: string;
  event: 'start' | 'stop' | 'status' | 'error' | 'heartbeat';
  source_name?: string;
  source_type?: string;
  project?: string;
  machine?: string;
  state?: string;
  activity?: string;
  url?: string;
  token?: string;
}

const REQUIRED_FIELDS = ['source_id', 'event'] as const;
const VALID_EVENTS = new Set(['start', 'stop', 'status', 'error', 'heartbeat']);

export function createWebhookRouter(sessionManager: SessionManager, wsServer: WSServer): Router {
  const router = Router();
  const webhookToken = process.env.WEBHOOK_TOKEN ?? null;

  router.post('/api/webhooks', (req, res) => {
    try {
      // Auth check
      if (webhookToken) {
        const authHeader = req.headers.authorization;
        const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const bodyToken = (req.body as Record<string, unknown>)?.token as string | undefined;
        if (headerToken !== webhookToken && bodyToken !== webhookToken) {
          res.status(401).json({ ok: false, error: 'Invalid or missing token' });
          return;
        }
      }

      const body = req.body as WebhookPayload;

      // Validate required fields
      for (const field of REQUIRED_FIELDS) {
        if (!body[field]) {
          res.status(400).json({ ok: false, error: `${field} is required` });
          return;
        }
      }

      if (!VALID_EVENTS.has(body.event)) {
        res.status(400).json({ ok: false, error: `Invalid event: ${body.event}` });
        return;
      }

      const agentId = `wh:${body.source_id}`;

      // eslint-disable-next-line no-console
      console.log(`[webhook] ${body.event} from ${body.source_name ?? body.source_id} (${agentId})`);

      if (body.event === 'start') {
        sessionManager.registerWebhookAgent(body.source_id, {
          sourceName: body.source_name,
          sourceType: body.source_type,
          project: body.project,
          machine: body.machine,
          state: body.state,
          activity: body.activity,
          url: body.url,
        });
        wsServer.broadcastSnapshot();
        res.status(200).json({ ok: true, agentId });
        return;
      }

      if (body.event === 'status') {
        const agent = sessionManager.updateWebhookAgent(
          agentId,
          body.state ?? null,
          body.activity ?? null,
          body.url ?? null,
        );
        if (!agent) {
          res.status(404).json({ ok: false, error: 'Agent not found. Send start event first.' });
          return;
        }
        wsServer.broadcastSnapshot();
        res.status(200).json({ ok: true });
        return;
      }

      if (body.event === 'stop') {
        const removed = sessionManager.removeWebhookAgent(agentId);
        if (!removed) {
          res.status(404).json({ ok: false, error: 'Agent not found' });
          return;
        }
        wsServer.broadcastSnapshot();
        res.status(200).json({ ok: true });
        return;
      }

      if (body.event === 'error') {
        const agent = sessionManager.updateWebhookAgent(agentId, 'error', body.activity ?? 'Error', body.url ?? null);
        if (!agent) {
          res.status(404).json({ ok: false, error: 'Agent not found' });
          return;
        }
        wsServer.broadcastSnapshot();
        res.status(200).json({ ok: true });
        return;
      }

      if (body.event === 'heartbeat') {
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
