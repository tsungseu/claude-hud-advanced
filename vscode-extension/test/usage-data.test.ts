import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readDailyUsage } from '../src/usage-data';

test('readDailyUsage returns a CONTINUOUS 30-day axis, filling idle days with zero buckets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  // Turns on two days; the rest of the 30-day window must still appear as
  // zero buckets so the chart timeline is unbroken.
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-05T13:10:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-05T23:30:00.000Z', message: { usage: { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T00:05:00.000Z', message: { usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    // consecutive duplicate — must be skipped.
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T00:06:00.000Z', message: { usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');

  // now = 2026-07-06T15:00:00Z; window start = 2026-06-06.
  const now = Date.parse('2026-07-06T15:00:00.000Z');
  const buckets = readDailyUsage(dir, now);

  // Exactly 30 buckets, ascending, contiguous days ending today (UTC).
  assert.equal(buckets.length, 30);
  assert.equal(buckets[29].day, '2026-07-06');
  // Consecutive day keys (1 day apart) — the timeline is unbroken.
  for (let i = 1; i < buckets.length; i++) {
    const prev = Date.parse(buckets[i - 1].day + 'T00:00:00.000Z');
    const cur = Date.parse(buckets[i].day + 'T00:00:00.000Z');
    assert.equal(cur - prev, 86_400_000, `gap at index ${i}: ${buckets[i - 1].day} -> ${buckets[i].day}`);
  }
  // 2026-07-05: 100+10+5+0 + 200+20+0+50 = 385
  const d5 = buckets.find((b) => b.day === '2026-07-05');
  assert.ok(d5);
  assert.equal(d5!.tokens, 385);
  // 2026-07-06: 50+5+0+0 = 55 (dedup drops the duplicate).
  const d6 = buckets.find((b) => b.day === '2026-07-06');
  assert.ok(d6);
  assert.equal(d6!.tokens, 55);
  // Idle day present as zero.
  const d1 = buckets.find((b) => b.day === '2026-07-01');
  assert.ok(d1);
  assert.equal(d1!.tokens, 0);
});

test('readDailyUsage drops turns older than 30 days (but still returns 30 zero buckets)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-05-04T13:00:00.000Z', message: { usage: { input_tokens: 999, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:00:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');
  const now = Date.parse('2026-07-06T15:00:00.000Z');
  const buckets = readDailyUsage(dir, now);
  // Still a full 30-day axis...
  assert.equal(buckets.length, 30);
  // ...only the in-window turn counts; the old one is dropped.
  const d6 = buckets.find((b) => b.day === '2026-07-06');
  assert.ok(d6);
  assert.equal(d6!.tokens, 100);
});

test('readDailyUsage returns empty array when dir missing', () => {
  const buckets = readDailyUsage('/nonexistent/dir/xyz', Date.parse('2026-07-06T15:00:00.000Z'));
  assert.deepEqual(buckets, []);
});
