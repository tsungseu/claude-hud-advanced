import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readHourlyUsage } from '../src/usage-data';

test('readHourlyUsage buckets assistant turns by hour across files, deduping consecutive dupes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  // Two sessions; the second has a consecutive duplicate usage block.
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:10:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:30:00.000Z', message: { usage: { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T14:05:00.000Z', message: { usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'b.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:50:00.000Z', message: { usage: { input_tokens: 300, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    // consecutive duplicate of the previous usage — must be skipped.
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:51:00.000Z', message: { usage: { input_tokens: 300, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');

  // now = 2026-07-06T15:00:00Z, so 24h window starts at 2026-07-05T15:00:00Z; all turns are within.
  const now = Date.parse('2026-07-06T15:00:00.000Z');
  const buckets = readHourlyUsage(dir, now);

  assert.equal(buckets.length, 2);
  const h13 = buckets[0];
  assert.equal(h13.hour, '2026-07-06T13:00:00.000Z');
  assert.equal(h13.inputTokens, 600);     // 100 + 200 + 300
  assert.equal(h13.outputTokens, 60);     // 10 + 20 + 30
  assert.equal(h13.cacheTokens, 55);      // (5+0) + (0+50) + (0+0)
  const h14 = buckets[1];
  assert.equal(h14.hour, '2026-07-06T14:00:00.000Z');
  assert.equal(h14.inputTokens, 50);
});

test('readHourlyUsage drops turns older than 24h', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-04T13:00:00.000Z', message: { usage: { input_tokens: 999, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:00:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');
  const now = Date.parse('2026-07-06T15:00:00.000Z');
  const buckets = readHourlyUsage(dir, now);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].inputTokens, 100);
});

test('readHourlyUsage returns empty array when dir missing', () => {
  const buckets = readHourlyUsage('/nonexistent/dir/xyz', Date.parse('2026-07-06T15:00:00.000Z'));
  assert.deepEqual(buckets, []);
});
