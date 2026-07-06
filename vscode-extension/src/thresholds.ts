// Status bar background-color mapping for urgency levels.
// (The level-determination logic lives in bar.ts: contextLevel/quotaLevel.)
import type { Level } from './bar';

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
