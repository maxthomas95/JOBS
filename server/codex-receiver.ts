import { Router } from 'express';
import { CodexProvider, type CodexSessionSink } from './codex-provider.js';
import type { PixelEvent } from '../src/types/events.js';

/** Mount ingestion behind bearer auth and health behind viewer auth in server/index.ts. */
export function createCodexRouter(sink: CodexSessionSink, publish?: (event: PixelEvent) => void): Router {
  const router = Router();
  const provider = new CodexProvider(sink, publish);
  router.get('/api/providers', (_req, res) => res.json({ providers: [provider.health()] }));
  router.post('/api/codex/hooks', (req, res) => {
    if (req.body?.diagnostic === 'jobs-delivery-check-v1') {
      provider.check();
      res.json({ ok: true, diagnostic: 'jobs-delivery-check-v1' });
      return;
    }
    const result = provider.ingest(req.body);
    const valid = result.reason !== 'unsupported-or-invalid';
    res.status(valid ? 200 : 400).json({ ok: valid, ...result });
  });
  router.post('/api/codex/notify', (req, res) => {
    const result = provider.ingest(req.body, 'notify');
    // Unknown notify events are harmless no-ops for compatibility with future Codex versions.
    res.json({ ok: true, ...result });
  });
  return router;
}
