import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDailyChartHtml } from '../src/chart-html';
import type { DailyBucket } from '../src/usage-data';

test('renderDailyChartHtml returns placeholder for empty buckets', () => {
  const html = renderDailyChartHtml([]);
  assert.match(html, /最近 30 天无用量数据/);
  assert.doesNotMatch(html, /chart-bar/);
});

test('renderDailyChartHtml renders one bar per bucket (including zero days) — continuous timeline', () => {
  const buckets: DailyBucket[] = [
    { day: '2026-07-04', tokens: 100 },
    { day: '2026-07-05', tokens: 0 },
    { day: '2026-07-06', tokens: 300 },
  ];
  const html = renderDailyChartHtml(buckets);
  // ALL buckets render (idle days are NOT filtered out — continuous timeline).
  const barCount = (html.match(/chart-bar/g) || []).length;
  assert.equal(barCount, 3);
  // Y axis ticks present.
  assert.match(html, /chart-yaxis/);
  // NO stacked-segment classes (single-color design).
  assert.doesNotMatch(html, /seg-input|seg-output|seg-cache/);
  // NO old legend.
  assert.doesNotMatch(html, /chart-legend/);
});

test('renderDailyChartHtml scales bar height by the max-tokens day', () => {
  const buckets: DailyBucket[] = [
    { day: '2026-07-05', tokens: 100 },
    { day: '2026-07-06', tokens: 400 },
  ];
  const html = renderDailyChartHtml(buckets);
  const heights = [...html.matchAll(/height:\s*([0-9.]+)%/g)].map((m) => parseFloat(m[1]));
  assert.ok(heights.length >= 2);
  assert.ok(Math.max(...heights) > Math.min(...heights));
});

test('renderDailyChartHtml tooltip shows ONLY the token total (no date — X axis carries it)', () => {
  const buckets: DailyBucket[] = [
    { day: '2026-07-03', tokens: 12345 },
    { day: '2026-07-04', tokens: 0 },
  ];
  const html = renderDailyChartHtml(buckets);
  // Tooltip is the bare token total, no date prefix.
  assert.match(html, /data-tip="12\.3k tokens"/);
  assert.doesNotMatch(html, /data-tip="2026-07-03/);
});

test('renderDailyChartHtml marks the first/last bars as edge bars for tooltip alignment', () => {
  const buckets: DailyBucket[] = [
    { day: '2026-07-03', tokens: 1 },
    { day: '2026-07-04', tokens: 2 },
    { day: '2026-07-05', tokens: 3 },
  ];
  const html = renderDailyChartHtml(buckets);
  // First bar = left edge, last bar = right edge, middle bar = no edge.
  assert.match(html, /data-edge="left"/);
  assert.match(html, /data-edge="right"/);
  // Exactly one of each.
  assert.equal((html.match(/data-edge="left"/g) || []).length, 1);
  assert.equal((html.match(/data-edge="right"/g) || []).length, 1);
});
