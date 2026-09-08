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
  private readonly reads = new Map<string, Promise<void>>();
  private readonly checkpoints = new Map<string, Buffer>();
  private readonly discardPartial = new Set<string>();

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
      void this.enqueue(path, async () => {
        this.fileOffsets.delete(path);
        this.checkpoints.delete(path);
        this.discardPartial.delete(path);
        this.announcedSessions.delete(basename(path, '.jsonl'));
      });
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
    await Promise.all(this.reads.values());
  }

  private enqueue(filePath: string, operation: () => Promise<void>): Promise<void> {
    const next = (this.reads.get(filePath) ?? Promise.resolve()).then(operation);
    this.reads.set(filePath, next);
    void next.finally(() => {
      if (this.reads.get(filePath) === next) this.reads.delete(filePath);
    }).catch(() => {});
    return next;
  }

  private processFile(filePath: string, isInitialAdd: boolean): Promise<void> {
    return this.enqueue(filePath, () => this.readFile(filePath, isInitialAdd));
  }

  private async readFile(filePath: string, isInitialAdd: boolean): Promise<void> {
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

      if (isInitialAdd && !this.fileOffsets.has(filePath)) {
        // Start tailing from EOF so we do not replay historical events on server boot.
        this.fileOffsets.set(filePath, stat.size);
        const checkpoint = await this.readCheckpoint(filePath, stat.size);
        this.checkpoints.set(filePath, checkpoint);
        // A record already partially written at boot belongs to historical data.
        if (checkpoint.length && checkpoint[checkpoint.length - 1] !== 10) this.discardPartial.add(filePath);
        return;
      }

      const previousOffset = this.fileOffsets.get(filePath) ?? 0;
      const checkpoint = this.checkpoints.get(filePath);
      // Compare the bytes before the cursor as well as length: truncate-and-rewrite
      // can grow past the old offset before the next filesystem notification.
      if (stat.size < previousOffset || (checkpoint && !checkpoint.equals(await this.readCheckpoint(filePath, previousOffset)))) {
        this.fileOffsets.set(filePath, 0);
        this.checkpoints.delete(filePath);
        this.discardPartial.delete(filePath);
      }

      const nextOffset = this.fileOffsets.get(filePath) ?? 0;
      if (stat.size <= nextOffset) return;

      // Read only new bytes from offset using a stream
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filePath, { start: nextOffset, end: stat.size - 1 });
        stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      const newData = Buffer.concat(chunks);

      // Handle partial lines: only process complete lines (ending with \n)
      const lastNewline = newData.lastIndexOf(10);
      if (lastNewline === -1) {
        // No complete line yet — don't advance offset
        return;
      }
      let start = 0;
      if (this.discardPartial.delete(filePath)) start = newData.indexOf(10) + 1;
      const completeText = newData.subarray(start, lastNewline).toString('utf8');
      const lines = completeText.split('\n').filter((line) => line.trim().length > 0);

      // Commit byte offsets before emitting so re-entrant change delivery is safe.
      this.fileOffsets.set(filePath, nextOffset + lastNewline + 1);
      this.checkpoints.set(filePath, await this.readCheckpoint(filePath, nextOffset + lastNewline + 1));

      for (const line of lines) {
        const payload: WatchLinePayload = { line, sessionId, agentId, filePath };
        this.emit('line', payload);
      }

    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.emit('error', error as Error);
    }
  }

  private async readCheckpoint(filePath: string, offset: number): Promise<Buffer> {
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(offset, 64));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset - buffer.length);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
