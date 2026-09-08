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
    this.data.globalToolCounts[tool] = (this.data.globalToolCounts[tool] ?? 0) + 1;
  }

  getStats(): StatsData {
    return this.data;
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
        const parsed = JSON.parse(raw) as Partial<StatsData>;
        return {
          dailySessions: parsed.dailySessions ?? [],
          agentHistory: parsed.agentHistory ?? [],
          globalToolCounts: parsed.globalToolCounts ?? {},
        };
      }
    } catch {
      // Corrupt or missing — start fresh
    }
    return emptyData();
  }
}
