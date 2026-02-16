import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

interface DailyRecord {
  date: string;       // YYYY-MM-DD
  sessionCount: number;
  totalMs: number;
}

interface SessionRecord {
  name: string;
  project: string | null;
  startedAt: number;
  endedAt: number | null;
  toolCounts: Record<string, number>;
}

interface StatsData {
  dailySessions: DailyRecord[];
  agentHistory: SessionRecord[];
  globalToolCounts: Record<string, number>;
}

export interface StatsSummary {
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

  constructor(filePath?: string) {
    this.filePath = filePath ?? process.env.STATS_FILE ?? 'data/stats.json';
    this.data = this.load();
    // Rebuild sessionIndex from any un-ended sessions
    for (let i = 0; i < this.data.agentHistory.length; i++) {
      const rec = this.data.agentHistory[i];
      if (rec.endedAt === null) {
        // Use name as key since we don't persist session IDs
        this.sessionIndex.set(rec.name, i);
      }
    }
    // Auto-flush every 60 seconds
    setInterval(() => this.flush(), 60000).unref();
  }

  recordSessionStart(sessionId: string, name: string, project: string | null): void {
    const today = todayStr();
    let daily = this.data.dailySessions.find((d) => d.date === today);
    if (!daily) {
      daily = { date: today, sessionCount: 0, totalMs: 0 };
      this.data.dailySessions.push(daily);
    }
    daily.sessionCount += 1;

    const idx = this.data.agentHistory.length;
    this.data.agentHistory.push({
      name,
      project,
      startedAt: Date.now(),
      endedAt: null,
      toolCounts: {},
    });
    this.sessionIndex.set(sessionId, idx);
  }

  recordSessionEnd(sessionId: string, toolCounts: Record<string, number>): void {
    const idx = this.sessionIndex.get(sessionId);
    if (idx === undefined) return;
    const rec = this.data.agentHistory[idx];
    rec.endedAt = Date.now();

    // Merge per-session tool counts
    for (const [tool, count] of Object.entries(toolCounts)) {
      rec.toolCounts[tool] = (rec.toolCounts[tool] ?? 0) + count;
    }

    // Accumulate daily totalMs
    const today = todayStr();
    let daily = this.data.dailySessions.find((d) => d.date === today);
    if (!daily) {
      daily = { date: today, sessionCount: 0, totalMs: 0 };
      this.data.dailySessions.push(daily);
    }
    daily.totalMs += rec.endedAt - rec.startedAt;

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
    const totalMs = this.data.dailySessions.reduce((sum, d) => sum + d.totalMs, 0);
    const totalHours = Math.round((totalMs / 3600000) * 10) / 10;

    const sorted = Object.entries(this.data.globalToolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, count]) => ({ tool, count }));

    return { sessionsToday, totalSessions, totalHours, topTools: sorted };
  }

  flush(): void {
    // Trim: keep last 30 days
    if (this.data.dailySessions.length > 30) {
      this.data.dailySessions = this.data.dailySessions.slice(-30);
    }
    // Trim: keep last 100 session records
    if (this.data.agentHistory.length > 100) {
      const removed = this.data.agentHistory.length - 100;
      this.data.agentHistory = this.data.agentHistory.slice(-100);
      // Adjust sessionIndex offsets
      for (const [key, idx] of this.sessionIndex.entries()) {
        const newIdx = idx - removed;
        if (newIdx < 0) {
          this.sessionIndex.delete(key);
        } else {
          this.sessionIndex.set(key, newIdx);
        }
      }
    }

    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[stats] flush error:', (err as Error).message);
    }
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
