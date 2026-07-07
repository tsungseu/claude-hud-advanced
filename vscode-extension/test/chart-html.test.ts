import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHourlyChartHtml } from '../src/chart-html';
import type { HourlyBucket } from '../src/usage-data';

test('renderHourlyChartHtml returns placeholder for empty buckets', () => {
  const html = renderHourlyChartHtml([]);
  assert.match(html, /最近 24h 无用量数据/);
  assert.doesNotMatch(html, /chart-bar/);
});

test('renderHourlyChartHtml renders one bar per bucket (including zero buckets) with hour-range labels', () => {
  const buckets: HourlyBucket[] = [
    { hour: '2026-07-06T12:00:00.000Z', tokens: 100 },
    { hour: '2026-07-06T13:00:00.000Z', tokens: 0 },
    { hour: '2026-07-06T14:00:00.000Z', tokens: 300 },
  ];
  const html = renderHourlyChartHtml(buckets);
  // ALL buckets render (idle hours are NOT filtered out — continuous timeline).
  const barCount = (html.match(/chart-bar/g) || []).length;
  assert.equal(barCount, 3);
  // Y axis ticks present.
  assert.match(html, /chart-yaxis/);
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
  const heights = [...html.matchAll(/height:\s*([0-9.]+)%/g)].map((m) => parseFloat(m[1]));
  assert.ok(heights.length >= 2);
  assert.ok(Math.max(...heights) > Math.min(...heights));
});

test('renderHourlyChartHtml tooltip + sparse labels use HH:00-HH:00 hour-range format', () => {
  // 5 hours so a sparse label index lands on the first bar.
  const buckets: HourlyBucket[] = [
    { hour: '2026-07-06T05:00:00.000Z', tokens: 12345 },
    { hour: '2026-07-06T06:00:00.000Z', tokens: 0 },
    { hour: '2026-07-06T07:00:00.000Z', tokens: 0 },
    { hour: '2026-07-06T08:00:00.000Z', tokens: 0 },
    { hour: '2026-07-06T09:00:00.000Z', tokens: 0 },
  ];
  const html = renderHourlyChartHtml(buckets);
  // Tooltip on the 05:00 bar shows the range + formatted total.
  assert.match(html, /data-tip="05:00-06:00 · 12\.3k tokens"/);
  // The 23:00 wrap case renders 23:00-00:00, not 23:00-24:00.
  const wrapHtml = renderHourlyChartHtml([{ hour: '2026-07-06T23:00:00.000Z', tokens: 1 }]);
  assert.match(wrapHtml, /23:00-00:00/);
});
