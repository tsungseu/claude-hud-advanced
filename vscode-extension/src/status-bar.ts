// Owns the always-visible status bar item and the periodic snapshot collection.
// The detail panel subscribes via onDidUpdate to ride on the same refresh cadence.
//
// The status bar text uses a state-aware leading codicon ($(pulse) normal,
// $(warning) near limit, $(error) at limit, $(clock) snapshot stale) as the
// "status overlay indicator" on the bar icon. Hovering shows the full dashboard
// tooltip (GFM tables).
import * as vscode from 'vscode';
import { collectHudSnapshot, HudSnapshot } from './usage-data';
import { resolveActiveTranscript } from './transcript-resolver';
import { readSettings } from './config';
import { statusColor } from './thresholds';
import {
  renderBar,
  renderPercent,
  renderCountdownShort,
  renderResetCountdown,
  formatTokens,
  contextLevel,
  quotaLevel,
  levelCodicon,
  statusCodicon,
  Level,
} from './bar';

const TOOLTIP_BAR_WIDTH = 10;

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
    this.refresh();
    this.timer = setInterval(() => this.refresh(), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  refreshNow(): void {
    this.refresh();
  }

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
      pricing: settings.pricing,
      transcriptMatchStrategy: matchStrategy,
    });

    this.last = snapshot;
    this.render(snapshot);
    this._onDidUpdate.fire(snapshot);
  }

  private render(snapshot: HudSnapshot): void {
    if (!snapshot.workspaceFolder || !snapshot.transcriptPath) {
      this.renderIdle();
      return;
    }

    const usagePct = snapshot.usage?.fiveHourPercent ?? snapshot.usage?.sevenDayPercent ?? null;
    const overallLevel = overallStatusLevel(snapshot);

    // Leading codicon doubles as the status overlay indicator.
    const prefix = leadingCodicon(snapshot, overallLevel);

    const ctxBar = renderBar(snapshot.contextPercent, 8);
    const ctxPct = renderPercent(snapshot.contextPercent);

    let text = `${prefix} ctx ${ctxBar} ${ctxPct}`;

    if (usagePct !== null) {
      const usageBar = renderBar(usagePct, 8);
      const reset = renderResetCountdown(snapshot.usage?.fiveHourResetAt ?? snapshot.usage?.sevenDayResetAt ?? null);
      text += `  │  5h ${usageBar} ${renderPercent(usagePct)}` + (reset ? ` (${reset})` : '');
    } else if (snapshot.usage?.balanceLabel) {
      text += `  │  ${snapshot.usage.balanceLabel}`;
    } else {
      text += `  │  —`;
    }

    this.item.text = text;
    this.item.tooltip = this.buildTooltip(snapshot);
    this.item.backgroundColor = undefined;
    this.item.color = undefined;

    // Background highlight on the most urgent level (critical > warn).
    const bg = statusColor(overallLevel);
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

  /**
   * The dashboard tooltip — a popover-style card shown on hover. Built as GFM
   * tables (VSCode MarkdownString supports them) with █░ progress bars and
   * codicon status markers. Three blocks: 计划重置 / 积分与支出 / 上下文.
   */
  private buildTooltip(s: HudSnapshot): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.supportThemeIcons = true;
    md.supportHtml = true;

    // Header: model + status badge.
    const statusBadge = `${statusCodicon(s.snapshotStatus)} ${statusLabel(s)}`;
    md.appendMarkdown(`### ${s.modelLabel}  \n\n`);
    md.appendMarkdown(`${statusBadge}  \n\n`);

    // --- Block 1: 计划重置 (plan reset windows) ---
    md.appendMarkdown(`**计划重置**  \n\n`);
    md.appendMarkdown('| 窗口 | 用量 | 重置倒计时 |\n');
    md.appendMarkdown('|---|---|---|\n');
    md.appendMarkdown(windowRow('5小时', s.usage?.fiveHourPercent ?? null, s.usage?.fiveHourResetAt ?? null));
    md.appendMarkdown(windowRow('每周', s.usage?.sevenDayPercent ?? null, s.usage?.sevenDayResetAt ?? null));
    md.appendMarkdown('\n');

    // --- Block 2: 积分 / 支出 / 成本扫描 ---
    md.appendMarkdown(`**积分与支出**  \n\n`);
    md.appendMarkdown('| 项 | 数值 |\n');
    md.appendMarkdown('|---|---|\n');
    const costStr = s.sessionCostYuan !== null ? `≈¥${s.sessionCostYuan.toFixed(2)}` : '—';
    md.appendMarkdown(`| 会话成本 | ${costStr} |\n`);
    if (s.sessionTokens) {
      md.appendMarkdown(
        `| Token 明细 | ${formatTokens(s.sessionTokens.inputTokens)} in · ${formatTokens(s.sessionTokens.outputTokens)} out · ${formatTokens(s.sessionTokens.cacheCreationTokens)} cache |\n`,
      );
    }
    md.appendMarkdown(`| 余额 | — |\n`);
    md.appendMarkdown(`| 月支出 | — |\n`);
    md.appendMarkdown('\n');

    // --- Block 3: 上下文 ---
    md.appendMarkdown(`**上下文**  \n\n`);
    md.appendMarkdown('| 项 | 数值 |\n');
    md.appendMarkdown('|---|---|\n');
    const ctxStr = s.contextPercent !== null
      ? `${renderBar(s.contextPercent, TOOLTIP_BAR_WIDTH)} ${renderPercent(s.contextPercent)}`
      : '—';
    md.appendMarkdown(`| 用量 | ${ctxStr} |\n`);
    if (s.contextTokens) {
      const used = formatTokens(s.contextTokens.inputTokens + s.contextTokens.cacheCreationTokens + s.contextTokens.cacheReadTokens);
      md.appendMarkdown(`| Token | ${used} / ${formatTokens(s.windowSize)} |\n`);
    }
    md.appendMarkdown('\n');

    md.appendMarkdown(`最近 30 天每日用量见详情面板  \n\n---\n\n$(info) 点击查看用量仪表盘`);
    return md;
  }
}

/** Overall level = the most urgent across context + all usage windows + snapshot freshness. */
function overallStatusLevel(s: HudSnapshot): Level {
  if (s.snapshotStatus === 'missing' || s.snapshotStatus === 'stale') {
    // stale/missing isn't "critical" by itself; defer to actual usage levels.
  }
  const levels: Level[] = [contextLevel(s.contextPercent)];
  const u = s.usage;
  if (u) {
    levels.push(quotaLevel(u.fiveHourPercent), quotaLevel(u.sevenDayPercent));
  }
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('warn')) return 'warn';
  return 'ok';
}

/** The leading codicon for the status bar text — the "overlay indicator". */
function leadingCodicon(s: HudSnapshot, level: Level): string {
  if (s.snapshotStatus === 'stale') return '$(clock)';
  if (s.snapshotStatus === 'missing') return '$(pulse)';
  return levelCodicon(level) === '$(check)' ? '$(pulse)' : levelCodicon(level);
}

/** Human status label for the tooltip header badge. */
function statusLabel(s: HudSnapshot): string {
  if (s.snapshotStatus === 'stale') return '快照过期';
  if (s.snapshotStatus === 'missing') return '无快照';
  const u = s.usage;
  const five = u?.fiveHourPercent ?? null;
  const seven = u?.sevenDayPercent ?? null;
  if (five !== null && five >= 90) return '已达上限';
  if (seven !== null && seven >= 90) return '已达上限';
  if (five !== null && five >= 75) return '接近上限';
  if (seven !== null && seven >= 75) return '接近上限';
  return '正常';
}

/** One window row of the 计划重置 table, with a level codicon prefix. */
function windowRow(label: string, percent: number | null, resetAt: Date | null): string {
  const level = quotaLevel(percent);
  const icon = levelCodicon(level);
  const bar = renderBar(percent, TOOLTIP_BAR_WIDTH);
  const pct = renderPercent(percent);
  const countdown = renderCountdownShort(resetAt);
  return `| ${icon} ${label} | ${bar} ${pct} | ${countdown} |\n`;
}

function currentWorkspaceFolder(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  const fsPath = folders[0].uri.fsPath;
  if (isDriveRoot(fsPath)) {
    return null;
  }
  return fsPath;
}

function isDriveRoot(fsPath: string): boolean {
  if (!fsPath) return true;
  const normalized = fsPath.replace(/\\/g, '/').toLowerCase();
  if (normalized === '/') return true;
  return /^[a-z]:\/?$/.test(normalized);
}
