import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readDailyUsage } from '../src/usage-data';

test('readDailyUsage buckets assistant turns by UTC day across files, deduping consecutive dupes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  // Two sessions; the second has a consecutive duplicate usage block.
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:10:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T23:30:00.000Z', message: { usage: { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-07T00:05:00.000Z', message: { usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'b.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:50:00.000Z', message: { usage: { input_tokens: 300, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    // consecutive duplicate of the previous usage — must be skipped.
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:51:00.000Z', message: { usage: { input_tokens: 300, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');

  // now = 2026-07-07T01:00:00Z; 31d window starts 2026-06-06, all turns within.
  const now = Date.parse('2026-07-07T01:00:00.000Z');
  const buckets = readDailyUsage(dir, now);

  assert.equal(buckets.length, 2);
  const d6 = buckets[0];
  assert.equal(d6.day, '2026-07-06');
  // 2026-07-06: 100+10+5+0 + 200+20+0+50 + 300+30+0+0 = 715
  assert.equal(d6.tokens, 715);
  const d7 = buckets[1];
  assert.equal(d7.day, '2026-07-07');
  // 2026-07-07: 50+5+0+0 = 55
  assert.equal(d7.tokens, 55);
});

test('readDailyUsage drops turns older than 31 days', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-05-04T13:00:00.000Z', message: { usage: { input_tokens: 999, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:00:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');
  const now = Date.parse('2026-07-07T01:00:00.000Z');
  const buckets = readDailyUsage(dir, now);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].day, '2026-07-06');
  assert.equal(buckets[0].tokens, 100);
});

test('readDailyUsage returns empty array when dir missing', () => {
  const buckets = readDailyUsage('/nonexistent/dir/xyz', Date.parse('2026-07-07T01:00:00.000Z'));
  assert.deepEqual(buckets, []);
});
