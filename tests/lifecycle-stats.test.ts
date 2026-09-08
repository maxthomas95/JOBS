import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StatsStore } from '../server/stats-store.js';
import { SessionManager } from '../server/session-manager.js';

test('stats starts/ends are idempotent and restart excludes unobserved downtime', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'jobs-stats-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let now = Date.parse('2026-09-07T23:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const file = join(directory, 'stats.json');
  const store = new StatsStore(file);
  t.after(() => store.dispose());
  store.recordSessionStart('session', 'Fixture', null);
  store.recordSessionStart('session', 'Fixture', null);
  now += 2 * 3600000;
  store.recordSessionActivity('session');
  store.flush();
  now += 7 * 86400000;
  const restarted = new StatsStore(file);
  t.after(() => restarted.dispose());
  const data = restarted.getStats();
  assert.equal(data.agentHistory.length, 1);
  assert.equal(data.agentHistory[0].endedAt, Date.parse('2026-09-08T01:00:00Z'));
  assert.equal(data.dailySessions.find(day => day.date === '2026-09-07')?.totalMs, 3600000);
  assert.equal(data.dailySessions.find(day => day.date === '2026-09-08')?.totalMs, 3600000);
  restarted.recordSessionEnd('session', {});
  assert.equal(restarted.getSummary().totalHours, 2);
  assert.equal(restarted.getSummary().totalSessions, 1);
  assert.equal(restarted.getSummary().timezone, 'UTC');
});

test('stale eviction closes accounting at last activity and resume starts a fresh observed interval', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'jobs-stale-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let now = Date.parse('2026-09-07T10:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const store = new StatsStore(join(directory, 'stats.json'));
  const manager = new SessionManager(60000, 180000);
  t.after(() => { manager.dispose(); store.dispose(); });
  manager.setStatsStore(store);
  const agent = manager.registerWebhookAgent('fixture', { state: 'running' });
  const start = agent.startedAt;
  now += 3600000;
  manager.updateWebhookAgent(agent.id, 'running', null, null);
  const lastActivity = now;
  now += 3600000;
  (manager as unknown as { sweepStaleSessions(): void }).sweepStaleSessions();
  assert.equal(agent.state, 'leaving');
  assert.equal(store.getStats().agentHistory[0].endedAt, lastActivity);
  assert.equal(store.getSummary().totalHours, 1);
  manager.registerWebhookAgent('fixture', { state: 'running' });
  assert.equal(agent.state, 'coding');
  assert.equal(agent.startedAt, now);
  assert.notEqual(agent.startedAt, start);
  assert.equal(store.getStats().agentHistory.filter(record => record.endedAt === null).length, 1);
});

test('history trimming preserves every active session for eventual accounting', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'jobs-active-stats-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let now = Date.parse('2026-09-07T10:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const store = new StatsStore(join(directory, 'stats.json'));
  t.after(() => store.dispose());
  for (let i = 0; i < 105; i++) store.recordSessionStart(`session-${i}`, 'Fixture', null);
  store.flush();
  now += 3600000;
  store.recordSessionEnd('session-0', {});
  assert.equal(store.getStats().agentHistory.find(record => record.sessionId === 'session-0')?.endedAt, now);
});

test('public stats redact legacy private fields, normalize project paths, and detach counters', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'jobs-public-stats-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'stats.json');
  const now = Date.now();
  const session = {
    sessionId: 'fixture', name: 'Fixture', project: 'C:\\PRIVATE_USER\\repo\\project',
    startedAt: now - 60000, endedAt: now - 30000, filePath: 'PRIVATE_TRANSCRIPT',
    toolCounts: { Read: 1, unknown_tool: { input: 'PRIVATE_INPUT' }, 'PRIVATE command text': 7 },
  };
  writeFileSync(file, JSON.stringify({
    rawTranscript: 'PRIVATE_TRANSCRIPT',
    dailySessions: [{ date: new Date(now).toISOString().slice(0, 10), sessionCount: 2, totalMs: 60000, raw: 'PRIVATE_RAW' }],
    agentHistory: [session, { ...session, sessionId: 'unix', project: '/PRIVATE_USER/work/another-project' }],
    globalToolCounts: { Read: 2, Write: 'PRIVATE_OUTPUT' },
  }));
  const store = new StatsStore(file);
  t.after(() => store.dispose());
  Object.assign(store.getStats(), { internalPrivateField: 'PRIVATE_LIVE' });
  Object.assign(store.getStats().agentHistory[0], { internalPrivateField: 'PRIVATE_LIVE' });
  const exposed = store.getPublicStats();
  assert.ok(!JSON.stringify(exposed).includes('PRIVATE_'));
  assert.deepEqual(exposed.agentHistory.map(record => record.project), ['project', 'another-project']);
  assert.deepEqual(exposed.globalToolCounts, { Read: 2 });
  exposed.agentHistory[0].toolCounts.Read = 500;
  assert.equal(store.getStats().agentHistory[0].toolCounts.Read, 1);
});

test('malformed persisted shapes cannot crash loading, summaries, or flush', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'jobs-invalid-stats-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixtures = [null, [], 5, { dailySessions: 'invalid', agentHistory: {}, globalToolCounts: [] }, {
    dailySessions: [null, { date: 'not-a-date', totalMs: 1, sessionCount: 1 }, { date: '2026-02-30', totalMs: 1, sessionCount: 1 }],
    agentHistory: [null, { startedAt: 'yesterday', endedAt: null }, { startedAt: 1e99, endedAt: null }],
    globalToolCounts: { Read: -1, Write: 'nope', Task: null },
  }];
  for (const [index, fixture] of fixtures.entries()) {
    const file = join(directory, `${index}.json`);
    writeFileSync(file, JSON.stringify(fixture));
    const store = new StatsStore(file);
    t.after(() => store.dispose());
    assert.deepEqual(store.getPublicStats(), { dailySessions: [], agentHistory: [], globalToolCounts: {} });
    assert.equal(store.getSummary().totalHours, 0);
    store.flush();
  }
});
