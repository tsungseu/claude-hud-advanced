import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHourlyChartHtml } from '../src/chart-html';
import type { HourlyBucket } from '../src/usage-data';

test('renderHourlyChartHtml returns placeholder for empty buckets', () => {
  const html = renderHourlyChartHtml([]);
  assert.match(html, /最近 24h 无用量数据/);
  assert.doesNotMatch(html, /chart-col/);
});

test('renderHourlyChartHtml renders one column per bucket with stacked segments', () => {
  const buckets: HourlyBucket[] = [
    { hour: '2026-07-06T13:00:00.000Z', inputTokens: 100, outputTokens: 50, cacheTokens: 200 },
    { hour: '2026-07-06T14:00:00.000Z', inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
    { hour: '2026-07-06T15:00:00.000Z', inputTokens: 300, outputTokens: 0, cacheTokens: 0 },
  ];
  const html = renderHourlyChartHtml(buckets);
  // Two non-zero columns rendered (the all-zero bucket is skipped).
  const colCount = (html.match(/chart-col/g) || []).length;
  assert.equal(colCount, 2);
  // Hour labels present.
  assert.match(html, /13/);
  assert.match(html, /15/);
  // Stacked segment classes present.
  assert.match(html, /seg-input/);
  assert.match(html, /seg-output/);
  assert.match(html, /seg-cache/);
});

test('renderHourlyChartHtml scales column height by the max-total bucket', () => {
  const buckets: HourlyBucket[] = [
    { hour: '2026-07-06T13:00:00.000Z', inputTokens: 100, outputTokens: 0, cacheTokens: 0 },
    { hour: '2026-07-06T14:00:00.000Z', inputTokens: 400, outputTokens: 0, cacheTokens: 0 },
  ];
  const html = renderHourlyChartHtml(buckets);
  // The taller column (400) should have a larger inline height than the 100 one.
  const heights = [...html.matchAll(/height:\s*([0-9.]+)%/g)].map((m) => parseFloat(m[1]));
  assert.ok(heights.length >= 2);
  assert.ok(Math.max(...heights) > Math.min(...heights));
});
