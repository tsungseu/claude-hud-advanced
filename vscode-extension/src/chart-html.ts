// Pure HTML generator for the per-hour usage chart. No vscode API, no IO —
// consumes HourlyBucket[] and returns an HTML string. Unit-testable.
import type { HourlyBucket } from './usage-data';

const COLORS = {
  input: '#00bfff',
  output: '#ff6347',
  cache: '#9b8bcf',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Render the per-hour usage chart as an HTML string. Each non-zero bucket is a
 * stacked column (input / output / cache); the busiest hour is full height and
 * others scale relative to it. Returns a placeholder message when buckets is
 * empty.
 */
export function renderHourlyChartHtml(buckets: HourlyBucket[]): string {
  const nonZero = buckets.filter((b) => b.inputTokens + b.outputTokens + b.cacheTokens > 0);
  if (nonZero.length === 0) {
    return `<div class="chart-empty">最近 24h 无用量数据</div>`;
  }

  const maxTotal = Math.max(...nonZero.map((b) => b.inputTokens + b.outputTokens + b.cacheTokens), 1);

  const cols = nonZero.map((b) => {
    const total = b.inputTokens + b.outputTokens + b.cacheTokens;
    const colHeightPct = (total / maxTotal) * 100;
    const segments = [
      b.inputTokens > 0 ? `<div class="seg seg-input" style="flex:${b.inputTokens};background:${COLORS.input}"></div>` : '',
      b.outputTokens > 0 ? `<div class="seg seg-output" style="flex:${b.outputTokens};background:${COLORS.output}"></div>` : '',
      b.cacheTokens > 0 ? `<div class="seg seg-cache" style="flex:${b.cacheTokens};background:${COLORS.cache}"></div>` : '',
    ].join('');
    const tip = `${escapeHtml(b.hour.slice(0, 16).replace('T', ' '))} · in ${formatK(b.inputTokens)} · out ${formatK(b.outputTokens)} · cache ${formatK(b.cacheTokens)}`;
    return `<div class="chart-col" style="height:${colHeightPct.toFixed(1)}%" data-tip="${escapeHtml(tip)}">${segments}</div>`;
  }).join('');

  const legend = `<div class="chart-legend"><span class="dot seg-input"></span> input <span class="dot seg-output"></span> output <span class="dot seg-cache"></span> cache</div>`;

  return `<div class="chart">${cols}</div><div class="chart-axis">${nonZero.map((b) => `<span>${b.hour.slice(11, 13)}</span>`).join('')}</div>${legend}`;
}
