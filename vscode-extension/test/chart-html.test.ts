import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDailyChartHtml } from '../src/chart-html';
import type { DailyBucket } from '../src/usage-data';

test('renderDailyChartHtml returns placeholder for empty buckets', () => {
  const html = renderDailyChartHtml([]);
  assert.match(html, /最近 31 天无用量数据/);
  assert.doesNotMatch(html, /chart-bar/);
});

test('renderDailyChartHtml renders one single-color bar per non-zero day', () => {
  const buckets: DailyBucket[] = [
    { day: '2026-07-04', tokens: 100 },
    { day: '2026-07-05', tokens: 0 },
    { day: '2026-07-06', tokens: 300 },
  ];
  const html = renderDailyChartHtml(buckets);
  // Two non-zero bars rendered (the zero bucket is skipped).
  const barCount = (html.match(/chart-bar/g) || []).length;
  assert.equal(barCount, 2);
  // Y axis ticks present.
  assert.match(html, /chart-yaxis/);
  // X axis present with sparse date labels (first day's label 7/4 shown).
  assert.match(html, /7\/4/);
  assert.match(html, /7\/6/);
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
  // The taller bar (400) should have a larger inline height than the 100 one.
  const heights = [...html.matchAll(/height:\s*([0-9.]+)%/g)].map((m) => parseFloat(m[1]));
  assert.ok(heights.length >= 2);
  assert.ok(Math.max(...heights) > Math.min(...heights));
});

test('renderDailyChartHtml includes per-bar hover tooltip with token total', () => {
  const buckets: DailyBucket[] = [{ day: '2026-07-06', tokens: 12345 }];
  const html = renderDailyChartHtml(buckets);
  assert.match(html, /data-tip="2026-07-06 · 12\.3k tokens"/);
});
