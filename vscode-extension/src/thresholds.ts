// Shared color/level thresholds, mirroring claude-hud src/render/colors.ts intent
// (context: green <70, yellow 70-85, red >85; quota: blue <75, magenta 75-89, red >=90).
// We return a theme-friendly VSCode ThemeColor so the bar adapts to light/dark.

export type Level = 'ok' | 'warn' | 'critical';

export function contextLevel(percent: number | null): Level {
  if (percent === null) return 'ok';
  if (percent >= 85) return 'critical';
  if (percent >= 70) return 'warn';
  return 'ok';
}

export function quotaLevel(percent: number | null): Level {
  if (percent === null) return 'ok';
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'warn';
  return 'ok';
}

/** A VSCode ThemeColor string for status bar foreground emphasis. */
export function statusColor(level: Level): string {
  switch (level) {
    case 'critical':
      return 'statusBarItem.errorBackground';
    case 'warn':
      return 'statusBarItem.warningBackground';
    default:
      return '';
  }
}

/** A hex color for use inside the webview (independent of the status bar theme). */
export function webviewHex(level: Level): string {
  switch (level) {
    case 'critical':
      return '#e5534b';
    case 'warn':
      return '#f0ad4e';
    default:
      return '#4aa8ff';
  }
}
