import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHourlyChartHtml } from '../src/chart-html';
import type { HourlyBucket } from '../src/usage-data';

test('renderHourlyChartHtml returns placeholder for empty buckets', () => {
  const html = renderHourlyChartHtml([]);
  assert.match(html, /最近 24h 无用量数据/);
  assert.doesNotMatch(html, /chart-bar/);
});

test('renderHourlyChartHtml renders one single-color bar per non-zero hour', () => {
  const buckets: HourlyBucket[] = [
    { hour: '2026-07-06T12:00:00.000Z', tokens: 100 },
    { hour: '2026-07-06T13:00:00.000Z', tokens: 0 },
    { hour: '2026-07-06T14:00:00.000Z', tokens: 300 },
  ];
  const html = renderHourlyChartHtml(buckets);
  // Two non-zero bars rendered (the zero bucket is skipped).
  const barCount = (html.match(/chart-bar/g) || []).length;
  assert.equal(barCount, 2);
  // Y axis ticks present.
  assert.match(html, /chart-yaxis/);
  // X axis present with hour labels (HH from the ISO key — "12" and "14").
  assert.match(html, /chart-xaxis/);
  // NO stacked-segment classes (single-color design).
  assert.doesNotMatch(html, /seg-input|seg-output|seg-cache/);
  // NO old legend.
  assert.doesNotMatch(html, /chart-legend/);
});

test('renderHourlyChartHtml scales bar height by the max-tokens hour', () => {
  const buckets: HourlyBucket[] = [
    { hour: '2026-07-06T13:00:00.000Z', tokens: 100 },
    { hour: '2026-07-06T14:00:00.000Z', tokens: 400 },
  ];
  const html = renderHourlyChartHtml(buckets);
  // The taller bar (400) should have a larger inline height than the 100 one.
  const heights = [...html.matchAll(/height:\s*([0-9.]+)%/g)].map((m) => parseFloat(m[1]));
  assert.ok(heights.length >= 2);
  assert.ok(Math.max(...heights) > Math.min(...heights));
});

test('renderHourlyChartHtml includes per-bar hover tooltip with hour + token total', () => {
  const buckets: HourlyBucket[] = [{ hour: '2026-07-06T14:00:00.000Z', tokens: 12345 }];
  const html = renderHourlyChartHtml(buckets);
  // tooltip shows the hour (space, not T) and the formatted total.
  assert.match(html, /data-tip="2026-07-06 14:00 · 12\.3k tokens"/);
});
