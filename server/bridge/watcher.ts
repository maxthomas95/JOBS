import { basename, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { WatchLinePayload, WatchSessionPayload } from './types.js';

const RECENT_MS = 10 * 60 * 1000;

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function isSessionJsonl(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!normalized.endsWith('.jsonl')) {
    return false;
  }
  if (normalized.endsWith('/history.jsonl')) {
    return false;
  }
  if (normalized.includes('/subagents/')) {
    return false;
  }
  const marker = '/projects/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return false;
  }
  const relative = normalized.slice(markerIndex + marker.length);
  const parts = relative.split('/').filter(Boolean);
  // Match ~/.claude/projects/<project>/<session>.jsonl only.
  return parts.length === 2;
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
        const normalized = normalizePath(path);
        if (normalized.includes('/subagents/')) {
          return true;
        }
        if (stats?.isFile()) {
          return !isSessionJsonl(path);
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
    if (!isSessionJsonl(filePath)) {
      return;
    }

    try {
      const stat = await fs.stat(filePath);
      if (Date.now() - stat.mtimeMs > RECENT_MS) {
        return;
      }

      const sessionId = basename(filePath, '.jsonl');
      const agentId = sessionId;
      if (!this.announcedSessions.has(sessionId)) {
        this.announcedSessions.add(sessionId);
        const sessionPayload: WatchSessionPayload = { sessionId, agentId, filePath };
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
