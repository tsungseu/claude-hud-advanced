// Progress-bar helpers for the status bar, mirroring claude-hud's block-bar
// style (src/render/colors.ts coloredBar/quotaBar) but plain text — VSCode
// status bar items don't render ANSI; coloring is done via the item's
// backgroundColor/themeColor, not per-character.

const FILLED = '█';
const EMPTY = '░';

/**
 * Render a `████░░░░░░` style bar of a fixed cell width.
 * Percent is clamped to 0-100; width is the total number of cells.
 */
export function renderBar(percent: number | null, width: number): string {
  const w = Math.max(1, Math.floor(width));
  if (percent === null || !Number.isFinite(percent)) {
    return EMPTY.repeat(w);
  }
  const p = Math.min(100, Math.max(0, percent));
  let filled = Math.round((p / 100) * w);
  // A non-zero usage should show at least one filled cell, otherwise a 6%
  // fill on an 8-cell bar (round(0.48)=0) renders as a fully empty bar,
  // which reads as "0%" — misleading. Clamp low non-zero fills up to 1.
  if (p > 0 && filled === 0) {
    filled = 1;
  }
  // Symmetric clamp: 99% shouldn't render as a full bar either.
  if (p < 100 && filled === w) {
    filled = w - 1;
  }
  return FILLED.repeat(filled) + EMPTY.repeat(w - filled);
}

/**
 * Compact percentage for a status bar cell: "30%" or "—".
 */
export function renderPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) {
    return '—';
  }
  return `${Math.min(100, Math.max(0, Math.round(percent)))}%`;
}

/**
 * Human-readable reset countdown: "resets in 2h 39m" / "resets in 5m".
 */
export function renderResetCountdown(resetAt: Date | null, now = Date.now()): string {
  if (!resetAt) {
    return '';
  }
  const ms = resetAt.getTime() - now;
  if (ms <= 0) {
    return 'resets soon';
  }
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) {
    return 'resets in <1m';
  }
  if (totalMin < 60) {
    return `resets in ${totalMin}m`;
  }
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 48) {
    return m > 0 ? `resets in ${h}h ${m}m` : `resets in ${h}h`;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `resets in ${d}d ${remH}h` : `resets in ${d}d`;
}
