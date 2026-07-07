import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readHourlyUsage } from '../src/usage-data';

test('readHourlyUsage returns a CONTINUOUS 24-hour axis, filling idle hours with zero buckets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  // Only two turns in the 13:00 and 14:00 hours; all other hours must still
  // appear as zero buckets so the chart timeline is unbroken.
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:10:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:30:00.000Z', message: { usage: { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T14:05:00.000Z', message: { usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    // consecutive duplicate — must be skipped.
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T14:06:00.000Z', message: { usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');

  const now = Date.parse('2026-07-06T15:00:00.000Z');
  const buckets = readHourlyUsage(dir, now);

  // Exactly 24 buckets, ascending, contiguous hours ending at the now-hour.
  assert.equal(buckets.length, 24);
  assert.equal(buckets[23].hour, '2026-07-06T15:00:00.000Z');
  // Consecutive hour keys (1h apart) — the timeline is unbroken.
  for (let i = 1; i < buckets.length; i++) {
    const prev = Date.parse(buckets[i - 1].hour);
    const cur = Date.parse(buckets[i].hour);
    assert.equal(cur - prev, 3600_000, `gap at index ${i}: ${buckets[i - 1].hour} -> ${buckets[i].hour}`);
  }
  // The 13:00 bucket totals all its turns (input+output+cache combined).
  const h13 = buckets.find((b) => b.hour === '2026-07-06T13:00:00.000Z');
  assert.ok(h13);
  // 100+10+5+0 + 200+20+0+50 = 385
  assert.equal(h13!.tokens, 385);
  // 14:00 bucket: 50+5+0+0 = 55 (dedup drops the duplicate).
  const h14 = buckets.find((b) => b.hour === '2026-07-06T14:00:00.000Z');
  assert.ok(h14);
  assert.equal(h14!.tokens, 55);
  // Idle hours present as zero.
  const h00 = buckets.find((b) => b.hour === '2026-07-06T00:00:00.000Z');
  assert.ok(h00);
  assert.equal(h00!.tokens, 0);
});

test('readHourlyUsage drops turns older than 24h (but still returns 24 zero buckets)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-04T13:00:00.000Z', message: { usage: { input_tokens: 999, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:00:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');
  const now = Date.parse('2026-07-06T15:00:00.000Z');
  const buckets = readHourlyUsage(dir, now);
  // Still a full 24h axis...
  assert.equal(buckets.length, 24);
  // ...only the in-window turn counts; the old one is dropped.
  const h13 = buckets.find((b) => b.hour === '2026-07-06T13:00:00.000Z');
  assert.ok(h13);
  assert.equal(h13!.tokens, 100);
});

test('readHourlyUsage returns empty array when dir missing', () => {
  const buckets = readHourlyUsage('/nonexistent/dir/xyz', Date.parse('2026-07-06T15:00:00.000Z'));
  assert.deepEqual(buckets, []);
});
