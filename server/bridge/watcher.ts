import { basename, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { promises as fs, createReadStream } from 'node:fs';
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
  /** Parent session UUID extracted from the file path (only set when isSubAgent is true) */
  parentSessionId: string | null;
}

function isSessionJsonl(filePath: string): SessionJsonlResult {
  const normalized = normalizePath(filePath);
  if (!normalized.endsWith('.jsonl')) {
    return { valid: false, isSubAgent: false, parentSessionId: null };
  }
  if (normalized.endsWith('/history.jsonl')) {
    return { valid: false, isSubAgent: false, parentSessionId: null };
  }
  const marker = '/projects/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return { valid: false, isSubAgent: false, parentSessionId: null };
  }
  const relative = normalized.slice(markerIndex + marker.length);
  const parts = relative.split('/').filter(Boolean);
  // Match ~/.claude/projects/<project>/<session>.jsonl (main sessions)
  if (parts.length === 2) {
    return { valid: true, isSubAgent: false, parentSessionId: null };
  }
  // Match ~/.claude/projects/<project>/<parent-session>/subagents/<session>.jsonl (sub-agent sessions)
  // parts[1] is the parent session UUID
  if (parts.length === 4 && parts[2] === 'subagents') {
    return { valid: true, isSubAgent: true, parentSessionId: parts[1] };
  }
  return { valid: false, isSubAgent: false, parentSessionId: null };
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
    this.watcher.on('unlink', (path) => {
      this.fileOffsets.delete(path);
      const sessionId = basename(path, '.jsonl');
      this.announcedSessions.delete(sessionId);
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
        const sessionPayload: WatchSessionPayload = {
          sessionId, agentId, filePath,
          isSubAgent: check.isSubAgent,
          parentSessionId: check.parentSessionId ?? undefined,
        };
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
      if (stat.size <= nextOffset) return;

      // Read only new bytes from offset using a stream
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filePath, { start: nextOffset });
        stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      const newData = Buffer.concat(chunks);
      const chunkText = newData.toString('utf8');

      // Handle partial lines: only process complete lines (ending with \n)
      const lastNewline = chunkText.lastIndexOf('\n');
      if (lastNewline === -1) {
        // No complete line yet — don't advance offset
        return;
      }
      const completeText = chunkText.slice(0, lastNewline);
      const lines = completeText.split('\n').filter((line) => line.trim().length > 0);

      for (const line of lines) {
        const payload: WatchLinePayload = { line, sessionId, agentId, filePath };
        this.emit('line', payload);
      }

      // Advance offset past the processed data (including the trailing \n)
      this.fileOffsets.set(filePath, nextOffset + lastNewline + 1);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }
}
