// Pure HTML generator for the 30-day daily-usage chart. No vscode API, no IO —
// consumes DailyBucket[] and returns an HTML string. Unit-testable.
//
// Design (matches the reference): a wide, short bar chart — one cyan bar per
// DAY over the last 30 days, height = that day's total tokens scaled to the
// busiest day. The full timeline renders (idle days are zero-height bars, not
// dropped) so every slot is a consecutive day. Horizontal gridlines + a Y axis
// with ~4 ticks, sparse X-axis date labels (M/D), hover tooltips. Single
// color, NOT a stacked breakdown.
import type { DailyBucket } from './usage-data';

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

/** Shorten YYYY-MM-DD to M/D for axis labels (e.g. "2026-07-03" -> "7/3"). */
function shortDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

/**
 * Pick evenly-spaced X-axis label indices across the buckets (~6 labels for
 * 30 days) so the axis isn't crowded. Always includes the last.
 */
function sparseLabelIndices(n: number): Set<number> {
  if (n <= 1) return new Set(n === 1 ? [0] : []);
  const target = Math.min(6, Math.max(2, Math.round(n / 5)));
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
 * Render the 30-day daily-usage chart as an HTML string. The full timeline is
 * rendered: idle days show as zero-height bars so every slot is a consecutive
 * day. The busiest day is full height and others scale relative to it.
 * Includes a Y axis with ~4 ticks, horizontal gridlines, sparse X-axis date
 * labels, and per-bar hover tooltips. Returns a placeholder message when the
 * bucket array itself is empty.
 */
export function renderDailyChartHtml(buckets: DailyBucket[]): string {
  if (buckets.length === 0) {
    return `<div class="chart-empty">最近 30 天无用量数据</div>`;
  }

  const maxTotal = Math.max(...buckets.map((b) => b.tokens), 1);
  const { ticks, scaledMax } = yAxis(maxTotal);
  const labelIdx = sparseLabelIndices(buckets.length);

  const n = buckets.length;
  const bars = buckets
    .map((b, i) => {
      const h = scaledMax > 0 ? (b.tokens / scaledMax) * 100 : 0;
      const tip = `${escapeAttr(b.day)} · ${formatK(b.tokens)} tokens`;
      // Mark edge bars so the hover tooltip can flip its alignment instead of
      // overflowing (and being clipped by) the card on the left/right edges.
      const edge = i === 0 ? ' data-edge="left"' : i === n - 1 ? ' data-edge="right"' : '';
      return `<div class="chart-bar" style="height:${h.toFixed(1)}%" data-tip="${escapeAttr(tip)}"${edge}></div>`;
    })
    .join('');

  // Y-axis ticks. Rendered top-to-bottom (highest first).
  const yAxisHtml = ticks
    .slice()
    .reverse()
    .map((t) => `<div class="chart-ytick"><span>${escapeHtml(t)}</span></div>`)
    .join('');

  // X-axis: one slot per bar; show the date label only at sparse indices.
  const xAxisHtml = buckets
    .map((b, i) => `<span>${labelIdx.has(i) ? escapeHtml(shortDate(b.day)) : ''}</span>`)
    .join('');

  return `<div class="chart-wrap">
    <div class="chart-yaxis">${yAxisHtml}</div>
    <div class="chart-plot">
      <div class="chart">${bars}</div>
      <div class="chart-xaxis">${xAxisHtml}</div>
    </div>
  </div>`;
}
