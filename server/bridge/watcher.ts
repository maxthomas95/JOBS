import { basename, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { WatchLinePayload, WatchSessionPayload } from './types.js';

/** For change events — file is actively being written to, generous window. */
const RECENT_MS = 10 * 60 * 1000;
/** For initial adds (server startup scan) — only show sessions that are very likely still active. */
const INITIAL_RECENT_MS = 2 * 60 * 1000;

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

interface SessionJsonlResult {
  valid: boolean;
  isSubAgent: boolean;
}

function isSessionJsonl(filePath: string): SessionJsonlResult {
  const normalized = normalizePath(filePath);
  if (!normalized.endsWith('.jsonl')) {
    return { valid: false, isSubAgent: false };
  }
  if (normalized.endsWith('/history.jsonl')) {
    return { valid: false, isSubAgent: false };
  }
  const marker = '/projects/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return { valid: false, isSubAgent: false };
  }
  const relative = normalized.slice(markerIndex + marker.length);
  const parts = relative.split('/').filter(Boolean);
  // Match ~/.claude/projects/<project>/<session>.jsonl (main sessions)
  if (parts.length === 2) {
    return { valid: true, isSubAgent: false };
  }
  // Match ~/.claude/projects/<project>/<parent-session>/subagents/<session>.jsonl (sub-agent sessions)
  if (parts.length === 4 && parts[2] === 'subagents') {
    return { valid: true, isSubAgent: true };
  }
  return { valid: false, isSubAgent: false };
}

export class SessionWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private readonly fileOffsets = new Map<string, number>();
  private readonly announcedSessions = new Set<string>();

  constructor(private readonly claudeDir: string) {
    super();
  }

  start(): void {
    const watchRoot = join(this.claudeDir, 'projects');
    this.watcher = chokidar.watch(watchRoot, {
      ignored: (path, stats) => {
        if (stats?.isFile()) {
          return !isSessionJsonl(path).valid;
        }
        return false;
      },
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (path) => {
      void this.processFile(path, true);
    });
    this.watcher.on('change', (path) => {
      void this.processFile(path, false);
    });
    this.watcher.on('error', (error) => {
      this.emit('error', error);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private async processFile(filePath: string, isInitialAdd: boolean): Promise<void> {
    const check = isSessionJsonl(filePath);
    if (!check.valid) {
      return;
    }

    try {
      const stat = await fs.stat(filePath);
      const maxAge = isInitialAdd ? INITIAL_RECENT_MS : RECENT_MS;
      if (Date.now() - stat.mtimeMs > maxAge) {
        return;
      }

      const sessionId = basename(filePath, '.jsonl');
      const agentId = sessionId;
      if (!this.announcedSessions.has(sessionId)) {
        this.announcedSessions.add(sessionId);
        const sessionPayload: WatchSessionPayload = { sessionId, agentId, filePath, isSubAgent: check.isSubAgent };
        this.emit('session', sessionPayload);
      }

      if (isInitialAdd) {
        // Start tailing from EOF so we do not replay historical events on server boot.
        this.fileOffsets.set(filePath, stat.size);
        return;
      }

      const previousOffset = this.fileOffsets.get(filePath) ?? 0;
      if (stat.size < previousOffset) {
        this.fileOffsets.set(filePath, 0);
      }

      const nextOffset = this.fileOffsets.get(filePath) ?? 0;
      const buffer = await fs.readFile(filePath);
      const chunk = buffer.subarray(nextOffset);
      const chunkText = chunk.toString('utf8');
      const lines = chunkText.split('\n').filter((line) => line.trim().length > 0);

      for (const line of lines) {
        const payload: WatchLinePayload = { line, sessionId, agentId, filePath };
        this.emit('line', payload);
      }

      this.fileOffsets.set(filePath, stat.size);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }
}
