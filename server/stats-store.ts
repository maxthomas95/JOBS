import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

interface DailyRecord {
  date: string;       // YYYY-MM-DD
  sessionCount: number;
  totalMs: number;
}

interface SessionRecord {
  sessionId?: string;
  name: string;
  project: string | null;
  startedAt: number;
  endedAt: number | null;
  lastObservedAt?: number;
  toolCounts: Record<string, number>;
}

interface StatsData {
  dailySessions: DailyRecord[];
  agentHistory: SessionRecord[];
  globalToolCounts: Record<string, number>;
}

export interface StatsSummary {
  timezone: 'UTC';
  sessionsToday: number;
  totalSessions: number;
  totalHours: number;
  topTools: Array<{ tool: string; count: number }>;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyData(): StatsData {
  return { dailySessions: [], agentHistory: [], globalToolCounts: {} };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value) ? value : undefined;
}

function projectBasename(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const part = value.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return part && part !== '.' && part !== '..' ? part.replace(/\p{Cc}/gu, '').slice(0, 128) || null : null;
}

function counts(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value) ?? {}).filter(
    (entry): entry is [string, number] => !!identifier(entry[0]) && nonnegative(entry[1]) && Number.isInteger(entry[1]),
  ));
}

/** Persisted files are untrusted input too: older versions may contain extra
 * runtime fields, and a partially edited document must not prevent startup. */
function parseStats(value: unknown): StatsData {
  const data = record(value);
  if (!data) return emptyData();
  const dailySessions: DailyRecord[] = [];
  const agentHistory: SessionRecord[] = [];
  for (const value of Array.isArray(data.dailySessions) ? data.dailySessions : []) {
    const day = record(value);
    if (!day || typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
    const date = Date.parse(`${day.date}T00:00:00Z`);
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== day.date) continue;
    if (!nonnegative(day.sessionCount) || !Number.isInteger(day.sessionCount) || !nonnegative(day.totalMs)) continue;
    dailySessions.push({ date: day.date, sessionCount: day.sessionCount, totalMs: day.totalMs });
  }
  const now = Date.now();
  const timestamp = (value: unknown): value is number => nonnegative(value) && value <= now;
  for (const value of Array.isArray(data.agentHistory) ? data.agentHistory : []) {
    const session = record(value);
    if (!session || !timestamp(session.startedAt)) continue;
    if (session.endedAt !== null && (!timestamp(session.endedAt) || session.endedAt < session.startedAt)) continue;
    agentHistory.push({
      sessionId: identifier(session.sessionId),
      name: typeof session.name === 'string' ? session.name.replace(/\p{Cc}/gu, '').slice(0, 64) : 'Unknown session',
      project: projectBasename(session.project),
      startedAt: session.startedAt,
      endedAt: session.endedAt as number | null,
      lastObservedAt: timestamp(session.lastObservedAt) ? Math.max(session.startedAt, session.lastObservedAt) : session.startedAt,
      toolCounts: counts(session.toolCounts),
    });
  }
  return { dailySessions, agentHistory, globalToolCounts: counts(data.globalToolCounts) };
}

export class StatsStore {
  private data: StatsData;
  private readonly filePath: string;
  /** Map session ID -> index in agentHistory for O(1) lookup on end */
  private readonly sessionIndex = new Map<string, number>();
  private readonly flushTimer: ReturnType<typeof setInterval>;

  constructor(filePath?: string) {
    this.filePath = filePath ?? process.env.STATS_FILE ?? 'data/stats.json';
    this.data = this.load();
    // A restart cannot prove that old sessions stayed active during downtime.
    // Close them at their last persisted observation, then let ingestion reopen.
    for (let i = 0; i < this.data.agentHistory.length; i++) {
      const rec = this.data.agentHistory[i];
      if (rec.endedAt === null && rec.sessionId) {
        this.sessionIndex.set(rec.sessionId, i);
        this.recordSessionEnd(rec.sessionId, {}, rec.lastObservedAt ?? rec.startedAt);
      }
    }
    // Auto-flush every 60 seconds
    this.flushTimer = setInterval(() => this.flush(), 60000).unref();
  }

  recordSessionStart(sessionId: string, name: string, project: string | null, startedAt = Date.now()): void {
    if (this.sessionIndex.has(sessionId)) return;
    const today = new Date(startedAt).toISOString().slice(0, 10);
    let daily = this.data.dailySessions.find((d) => d.date === today);
    if (!daily) {
      daily = { date: today, sessionCount: 0, totalMs: 0 };
      this.data.dailySessions.push(daily);
    }
    daily.sessionCount += 1;

    const idx = this.data.agentHistory.length;
    this.data.agentHistory.push({
      sessionId,
      name,
      project,
      startedAt,
      lastObservedAt: startedAt,
      endedAt: null,
      toolCounts: {},
    });
    this.sessionIndex.set(sessionId, idx);
  }

  recordSessionActivity(sessionId: string, timestamp = Date.now()): void {
    const idx = this.sessionIndex.get(sessionId);
    if (idx !== undefined) {
      const rec = this.data.agentHistory[idx];
      rec.lastObservedAt = Math.max(rec.lastObservedAt ?? rec.startedAt, timestamp);
    }
  }

  recordSessionEnd(sessionId: string, toolCounts: Record<string, number>, endedAt = Date.now()): void {
    const idx = this.sessionIndex.get(sessionId);
    if (idx === undefined) return;
    const rec = this.data.agentHistory[idx];
    rec.endedAt = Math.max(rec.startedAt, endedAt);

    // Merge per-session tool counts
    for (const [tool, count] of Object.entries(toolCounts)) {
      rec.toolCounts[tool] = (rec.toolCounts[tool] ?? 0) + count;
    }

    // Attribute elapsed time to each UTC day crossed by the active segment.
    for (let start = rec.startedAt; start < rec.endedAt;) {
      const date = new Date(start).toISOString().slice(0, 10);
      const end = Math.min(Date.parse(`${date}T00:00:00.000Z`) + 86400000, rec.endedAt);
      let daily = this.data.dailySessions.find((d) => d.date === date);
      if (!daily) {
        daily = { date, sessionCount: 0, totalMs: 0 };
        this.data.dailySessions.push(daily);
      }
      daily.totalMs += end - start;
      start = end;
    }

    this.sessionIndex.delete(sessionId);
  }

  recordToolUse(tool: string): void {
    const previous = Object.hasOwn(this.data.globalToolCounts, tool) ? this.data.globalToolCounts[tool] : 0;
    Object.defineProperty(this.data.globalToolCounts, tool, { value: previous + 1, writable: true, enumerable: true, configurable: true });
  }

  getStats(): StatsData {
    return this.data;
  }

  /** Explicit public shape, detached from both live counters and disk input. */
  getPublicStats(): StatsData {
    return {
      dailySessions: this.data.dailySessions.map(day => ({ date: day.date, sessionCount: day.sessionCount, totalMs: day.totalMs })),
      agentHistory: this.data.agentHistory.map(session => ({
        sessionId: session.sessionId,
        name: session.name,
        project: projectBasename(session.project),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        lastObservedAt: session.lastObservedAt,
        toolCounts: counts(session.toolCounts),
      })),
      globalToolCounts: counts(this.data.globalToolCounts),
    };
  }

  getSummary(): StatsSummary {
    const today = todayStr();
    const daily = this.data.dailySessions.find((d) => d.date === today);
    const sessionsToday = daily?.sessionCount ?? 0;
    const totalSessions = this.data.dailySessions.reduce((sum, d) => sum + d.sessionCount, 0);
    const activeMs = [...this.sessionIndex.values()].reduce((sum, idx) => sum + Math.max(0, Date.now() - this.data.agentHistory[idx].startedAt), 0);
    const totalMs = this.data.dailySessions.reduce((sum, d) => sum + d.totalMs, 0) + activeMs;
    const totalHours = Math.round((totalMs / 3600000) * 10) / 10;

    const sorted = Object.entries(this.data.globalToolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, count]) => ({ tool, count }));

    return { timezone: 'UTC', sessionsToday, totalSessions, totalHours, topTools: sorted };
  }

  flush(): void {
    this.data.dailySessions.sort((a, b) => a.date.localeCompare(b.date));
    // Trim: keep last 30 days
    if (this.data.dailySessions.length > 30) {
      this.data.dailySessions = this.data.dailySessions.slice(-30);
    }
    // Trim: keep last 100 session records
    if (this.data.agentHistory.length > 100) {
      const completed = this.data.agentHistory.filter(rec => rec.endedAt !== null).slice(-100);
      const active = this.data.agentHistory.filter(rec => rec.endedAt === null);
      this.data.agentHistory = [...completed, ...active];
      this.sessionIndex.clear();
      for (const [idx, rec] of this.data.agentHistory.entries()) {
        if (rec.endedAt === null && rec.sessionId) this.sessionIndex.set(rec.sessionId, idx);
      }
    }

    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const temporaryPath = `${this.filePath}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify(this.data, null, 2), 'utf-8');
      renameSync(temporaryPath, this.filePath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[stats] flush error:', (err as Error).message);
    }
  }

  dispose(): void {
    clearInterval(this.flushTimer);
  }

  private load(): StatsData {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        return parseStats(JSON.parse(raw));
      }
    } catch {
      // Corrupt or missing — start fresh
    }
    return emptyData();
  }
}
