import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionWatcher } from '../server/bridge/watcher.js';

test('JSONL tailing handles Unicode, byte-split records, overlapping reads and rewrites', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jobs-watcher-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, 'projects', 'fixture');
  await mkdir(project, { recursive: true });
  const path = join(project, 'session.jsonl');
  await writeFile(path, '');
  const watcher = new SessionWatcher(directory);
  t.after(() => watcher.stop());
  const reader = watcher as unknown as { processFile(path: string, initial: boolean): Promise<void> };
  const lines: string[] = [];
  const errors: Error[] = [];
  watcher.on('line', ({ line }: { line: string }) => lines.push(line));
  watcher.on('error', (error: Error) => errors.push(error));
  await reader.processFile(path, true);

  const first = JSON.stringify({ text: '👩🏽‍💻 café 漢字'.repeat(200), tool: 'A' });
  await appendFile(path, `${first}\n`);
  await Promise.all(Array.from({ length: 16 }, () => reader.processFile(path, false)));
  const second = Buffer.from(`${JSON.stringify({ text: '🦊', tool: 'B' })}\n`);
  const split = second.indexOf(Buffer.from('🦊')) + 2;
  await appendFile(path, second.subarray(0, split));
  await reader.processFile(path, false);
  assert.deepEqual(lines, [first]);
  await appendFile(path, second.subarray(split));
  await reader.processFile(path, false);
  assert.deepEqual(lines, [first, second.toString('utf8').trim()]);

  await writeFile(path, '{"tool":"C"}\n');
  await reader.processFile(path, false);
  await writeFile(path, '{"tool":"D","new":"longer rewrite"}\n');
  await reader.processFile(path, false);
  await reader.processFile(path, false);
  assert.deepEqual(lines.slice(2).map(line => JSON.parse(line).tool), ['C', 'D']);
  assert.deepEqual(errors, []);
});

test('restart skips historical records and the record partially written at startup', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jobs-watcher-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, 'projects', 'fixture');
  await mkdir(project, { recursive: true });
  const path = join(project, 'session.jsonl');
  await writeFile(path, '{"tool":"old"}\n{"tool":"partial');
  const watcher = new SessionWatcher(directory);
  t.after(() => watcher.stop());
  const reader = watcher as unknown as { processFile(path: string, initial: boolean): Promise<void> };
  const lines: string[] = [];
  watcher.on('line', ({ line }: { line: string }) => lines.push(line));
  await reader.processFile(path, true);
  await appendFile(path, '"}\n{"tool":"fresh"}\n');
  await reader.processFile(path, false);
  assert.deepEqual(lines, ['{"tool":"fresh"}']);
});
