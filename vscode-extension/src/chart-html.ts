// Pure HTML generator for the per-hour usage chart. No vscode API, no IO —
// consumes HourlyBucket[] and returns an HTML string. Unit-testable.
//
// Design (matches the reference): a wide, short bar chart — one cyan bar per
// HOUR over the last 24h, height = that hour's total tokens scaled to the
// busiest hour. Horizontal gridlines + a Y axis with ~4 ticks, sparse X-axis
// hour labels (every ~3h so ~24 bars stay readable), hover tooltips. Single
// color, NOT a stacked breakdown.
import type { HourlyBucket } from './usage-data';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** Compact token formatter: 1.2M / 12.3k / 999. */
function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Extract the HH from an ISO hour key "YYYY-MM-DDTHH:00:00.000Z" -> "HH". */
function hourLabel(hour: string): string {
  // ISO form is fixed-width; positions 11..13 are the two-digit hour.
  return hour.slice(11, 13);
}

/**
 * Pick evenly-spaced X-axis label indices across the buckets (~1 label per
 * 3 hours) so the axis isn't crowded when there are up to ~24 bars. Always
 * includes the last.
 */
function sparseLabelIndices(n: number): Set<number> {
  if (n <= 1) return new Set(n === 1 ? [0] : []);
  const target = Math.min(8, Math.max(2, Math.round(n / 3)));
  const set = new Set<number>();
  for (let i = 0; i < target; i++) {
    set.add(Math.round((i * (n - 1)) / (target - 1)));
  }
  return set;
}

/** "Nice" Y-axis tick values: round the max up to 1 / 2 / 5 × 10^k, then 4
 * evenly-spaced ticks (0, 1/3, 2/3, max). Returns the tick labels + the
 * scaled max used for bar-height math (so bars top out exactly at the top). */
function yAxis(max: number): { ticks: string[]; scaledMax: number } {
  if (max <= 0) return { ticks: ['0'], scaledMax: 1 };
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const frac = max / exp;
  let niceFrac: number;
  if (frac <= 1) niceFrac = 1;
  else if (frac <= 2) niceFrac = 2;
  else if (frac <= 5) niceFrac = 5;
  else niceFrac = 10;
  const scaledMax = niceFrac * exp;
  const ticks = [0, 1, 2, 3].map((i) => formatK((scaledMax * i) / 3));
  return { ticks, scaledMax };
}

/**
 * Render the per-hour usage chart as an HTML string. Each non-zero hour is a
 * single cyan bar; the busiest hour is full height and others scale relative
 * to it. Includes a Y axis with ~4 ticks, horizontal gridlines, sparse X-axis
 * hour labels, and per-bar hover tooltips. Returns a placeholder message when
 * buckets is empty.
 */
export function renderHourlyChartHtml(buckets: HourlyBucket[]): string {
  const nonZero = buckets.filter((b) => b.tokens > 0);
  if (nonZero.length === 0) {
    return `<div class="chart-empty">最近 24h 无用量数据</div>`;
  }

  const maxTotal = Math.max(...nonZero.map((b) => b.tokens), 1);
  const { ticks, scaledMax } = yAxis(maxTotal);
  const labelIdx = sparseLabelIndices(nonZero.length);

  const bars = nonZero
    .map((b) => {
      const h = scaledMax > 0 ? (b.tokens / scaledMax) * 100 : 0;
      const tip = `${escapeAttr(b.hour.slice(0, 16).replace('T', ' '))} · ${formatK(b.tokens)} tokens`;
      return `<div class="chart-bar" style="height:${h.toFixed(1)}%" data-tip="${escapeAttr(tip)}"></div>`;
    })
    .join('');

  // Y-axis ticks. Rendered top-to-bottom (highest first).
  const yAxisHtml = ticks
    .slice()
    .reverse()
    .map((t) => `<div class="chart-ytick"><span>${escapeHtml(t)}</span></div>`)
    .join('');

  // X-axis: one slot per bar, but only show a label at sparse indices.
  const xAxisHtml = nonZero
    .map((b, i) => `<span>${labelIdx.has(i) ? escapeHtml(hourLabel(b.hour)) : ''}</span>`)
    .join('');

  return `<div class="chart-wrap">
    <div class="chart-yaxis">${yAxisHtml}</div>
    <div class="chart-plot">
      <div class="chart">${bars}</div>
      <div class="chart-xaxis">${xAxisHtml}</div>
    </div>
  </div>`;
}
