// Owns the always-visible status bar item and the periodic snapshot collection.
// The detail panel subscribes via onDidUpdate to ride on the same refresh cadence.
import * as vscode from 'vscode';
import { collectHudSnapshot, HudSnapshot } from './usage-data';
import { resolveActiveTranscript } from './transcript-resolver';
import { readSettings } from './config';
import { contextLevel, quotaLevel, statusColor } from './thresholds';
import { renderBar, renderPercent, renderResetCountdown } from './bar';

export class StatusBarManager {
  private readonly item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | null = null;
  private last: HudSnapshot | null = null;
  private readonly _onDidUpdate = new vscode.EventEmitter<HudSnapshot | null>();
  readonly onDidUpdate = this._onDidUpdate.event;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'claudeHud.showDetail';
    this.item.name = 'Claude HUD';
    this.renderIdle();
    this.item.show();
  }

  start(): void {
    this.stop();
    const settings = readSettings();
    const interval = Math.max(500, settings.refreshIntervalMs);
    // Fire immediately, then on the interval.
    this.refresh();
    this.timer = setInterval(() => this.refresh(), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Force an immediate refresh (e.g. from the Refresh command). */
  refreshNow(): void {
    this.refresh();
  }

  /** The most recently collected snapshot (null until the first tick completes). */
  get latest(): HudSnapshot | null {
    return this.last;
  }

  dispose(): void {
    this.stop();
    this._onDidUpdate.dispose();
    this.item.dispose();
  }

  private refresh(): void {
    const folder = currentWorkspaceFolder();
    const settings = readSettings();

    let transcriptPath: string | null = null;
    let matchStrategy: import('./transcript-resolver').ResolvedTranscript['matchStrategy'] | 'none' = 'none';
    if (folder) {
      const resolved = resolveActiveTranscript(folder);
      transcriptPath = resolved?.transcriptPath ?? null;
      matchStrategy = resolved?.matchStrategy ?? 'none';
    }

    const snapshot = collectHudSnapshot(folder ?? '', transcriptPath, {
      windowSize: settings.contextWindowSize,
      modelLabelOverride: settings.modelLabel,
      providerSetting: settings.provider,
      snapshotFreshnessMs: settings.snapshotFreshnessMs,
      transcriptMatchStrategy: matchStrategy,
    });

    this.last = snapshot;
    this.render(snapshot);
    this._onDidUpdate.fire(snapshot);
  }

  private render(snapshot: HudSnapshot): void {
    // No workspace or no transcript: idle state.
    if (!snapshot.workspaceFolder || !snapshot.transcriptPath) {
      this.renderIdle();
      return;
    }

    // Compact bars for the status bar: keep them short since the cell is narrow.
    // Mirrors claude-hud's `Context ████░░░░░░ 41% │ Usage ██░░░░░░░░ 23%` style.
    const ctxBar = renderBar(snapshot.contextPercent, 8);
    const ctxPct = renderPercent(snapshot.contextPercent);

    const usage = snapshot.usage;
    const usagePct = usage?.fiveHourPercent ?? usage?.sevenDayPercent ?? null;

    let text = `$(pulse) ${ctxBar} ${ctxPct}`;

    if (usagePct !== null) {
      const usageBar = renderBar(usagePct, 8);
      const usagePctStr = renderPercent(usagePct);
      const reset = renderResetCountdown(usage?.fiveHourResetAt ?? usage?.sevenDayResetAt ?? null);
      text += `  │  ${usageBar} ${usagePctStr}` + (reset ? ` (${reset})` : '');
    } else if (usage?.balanceLabel) {
      text += `  │  ${usage.balanceLabel}`;
    } else {
      text += `  │  —`;
    }

    this.item.text = text;
    this.item.tooltip = this.buildTooltip(snapshot);
    this.item.backgroundColor = undefined;
    this.item.color = undefined;

    // Highlight on the most urgent of context/usage levels. critical > warn.
    const usagePctForLevel = snapshot.usage?.fiveHourPercent ?? snapshot.usage?.sevenDayPercent ?? null;
    const levels = [contextLevel(snapshot.contextPercent), quotaLevel(usagePctForLevel)];
    const level = levels.includes('critical')
      ? 'critical'
      : levels.includes('warn')
        ? 'warn'
        : 'ok';
    const bg = statusColor(level);
    if (bg) {
      this.item.backgroundColor = new vscode.ThemeColor(bg);
    }
  }

  private renderIdle(): void {
    const folder = currentWorkspaceFolder();
    this.item.text = '$(pulse) Claude';
    this.item.tooltip = folder
      ? 'Claude HUD: no active transcript found in ~/.claude/projects/ for this workspace yet.'
      : 'Claude HUD: open a workspace folder to begin tracking context & usage.';
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  private buildTooltip(s: HudSnapshot): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.supportThemeIcons = true;
    const lines: string[] = [`**${s.modelLabel}**`];

    if (s.contextPercent !== null && s.contextTokens) {
      const totalK = Math.round((s.contextTokens.inputTokens + s.contextTokens.cacheCreationTokens + s.contextTokens.cacheReadTokens) / 1000);
      lines.push(`Context: **${s.contextPercent}%**  (${totalK}k / ${Math.round(s.windowSize / 1000)}k)`);
    } else {
      lines.push('Context: — (no assistant turn yet)');
    }

    if (s.usage) {
      const parts: string[] = [];
      if (s.usage.fiveHourPercent !== null) parts.push(`5h ${s.usage.fiveHourPercent}%`);
      if (s.usage.sevenDayPercent !== null) parts.push(`7d ${s.usage.sevenDayPercent}%`);
      if (s.usage.balanceLabel) parts.push(s.usage.balanceLabel);
      if (s.usage.fiveHourResetAt) parts.push(`resets ${s.usage.fiveHourResetAt.toLocaleString()}`);
      lines.push(`Usage (${s.usage.provider}): ${parts.join(' · ')}`);
    } else {
      lines.push('Usage: no fresh provider snapshot');
    }

    lines.push('');
    lines.push(`Transcript: \`${shorten(s.transcriptPath ?? '', 60)}\``);
    lines.push('');
    lines.push('Click to open the full HUD detail panel.');
    md.appendMarkdown(lines.join('\n\n'));
    return md;
  }
}

function currentWorkspaceFolder(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  const fsPath = folders[0].uri.fsPath;
  // Refuse drive-root workspaces (e.g. "D:\"). A drive root contains protected
  // system folders (System Volume Information, $Recycle.Bin, Recovery) that
  // throw EPERM on stat. Operating there would cause the HUD — or the
  // dist/index.js subprocess we spawn with this as cwd — to trip over them.
  // Treat a drive root like "no workspace": render idle instead.
  if (isDriveRoot(fsPath)) {
    return null;
  }
  return fsPath;
}

/**
 * True when a path is exactly a Windows drive root ("D:\\", "D:/", "D:") or a
 * POSIX root ("/"). On Windows the comparison is case-insensitive.
 */
function isDriveRoot(fsPath: string): boolean {
  if (!fsPath) return true;
  const normalized = fsPath.replace(/\\/g, '/').toLowerCase();
  if (normalized === '/') return true;
  // "x:", "x:/"
  return /^[a-z]:\/?$/.test(normalized);
}

function shorten(p: string, max: number): string {
  if (p.length <= max) return p;
  return `…${p.slice(p.length - max + 1)}`;
}
