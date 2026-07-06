// Progress-bar + formatting helpers for the status bar and tooltip, mirroring
// claude-hud's block-bar style (src/render/colors.ts coloredBar/quotaBar) but
// plain text — VSCode status bar items and MarkdownString tooltips don't render
// ANSI; coloring is done via the item's backgroundColor/themeColor, and urgency
// in the tooltip is conveyed via codicons ($(error)/$(warning)).

const FILLED = '█';
const EMPTY = '░';

/**
 * Render a `████░░░░░░` style bar of a fixed cell width.
 * Percent is clamped to 0-100; width is the total number of cells.
 * Non-zero usage shows at least one filled cell (so 6% on a 10-cell bar
 * doesn't read as "0%"); non-full usage never fills every cell (so 99%
 * doesn't read as "100%").
 */
export function renderBar(percent: number | null, width: number): string {
  const w = Math.max(1, Math.floor(width));
  if (percent === null || !Number.isFinite(percent)) {
    return EMPTY.repeat(w);
  }
  const p = Math.min(100, Math.max(0, percent));
  let filled = Math.round((p / 100) * w);
  if (p > 0 && filled === 0) filled = 1;
  if (p < 100 && filled === w) filled = w - 1;
  return FILLED.repeat(filled) + EMPTY.repeat(w - filled);
}

/** Compact percentage: "30%" or "—" when unavailable. */
export function renderPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) {
    return '—';
  }
  return `${Math.min(100, Math.max(0, Math.round(percent)))}%`;
}

/** Compact reset countdown WITHOUT prefix, for table cells: "2h 39m". */
export function renderCountdownShort(resetAt: Date | null, now = Date.now()): string {
  if (!resetAt) return '—';
  const ms = resetAt.getTime() - now;
  if (ms <= 0) return 'soon';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return '<1m';
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 48) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}d ${remH}h` : `${d}d`;
}

/** Full reset countdown with prefix, for the status bar: "resets in 2h 39m". */
export function renderResetCountdown(resetAt: Date | null, now = Date.now()): string {
  const short = renderCountdownShort(resetAt, now);
  if (short === '—') return '';
  if (short === 'soon') return 'resets soon';
  return `resets in ${short}`;
}

/** Format a raw token count compactly: 1234 -> "1.2k", 1500000 -> "1.5M". */
export function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return '—';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

export type Level = 'ok' | 'warn' | 'critical';

/** Quota window level: warn 75-89%, critical >=90. */
export function quotaLevel(percent: number | null): Level {
  if (percent === null) return 'ok';
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'warn';
  return 'ok';
}

/** Context window level: warn 70-84, critical >=85 (matches claude-hud colors.ts). */
export function contextLevel(percent: number | null): Level {
  if (percent === null) return 'ok';
  if (percent >= 85) return 'critical';
  if (percent >= 70) return 'warn';
  return 'ok';
}

/** Codicon for a usage level (ok/warn/critical), for tooltip + status bar prefix. */
export function levelCodicon(level: Level): string {
  switch (level) {
    case 'critical':
      return '$(error)';
    case 'warn':
      return '$(warning)';
    default:
      return '$(check)';
  }
}

/** Codicon for the overall provider snapshot status. */
export function statusCodicon(status: 'fresh' | 'stale' | 'missing'): string {
  switch (status) {
    case 'fresh':
      return '$(check)';
    case 'stale':
      return '$(clock)';
    default:
      return '$(circle-slash)';
  }
}
