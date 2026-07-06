// The click-through dashboard panel: a styled usage card matching the reference
// design (dark card, cyan context bar, coral usage bar, status dot). Built as a
// webview so we get full CSS color control (the hover tooltip's MarkdownString
// can't do custom colors). Re-renders on each status bar snapshot tick while
// visible.
//
// A small "terminal HUD" link at the bottom switches to the legacy view: the
// full claude-hud colored statusline rendered by spawning dist/index.js. That
// view needs claude-hud installed; the dashboard card does not.
import * as vscode from 'vscode';
import { renderHudOnce, resolveHudEntry } from './hud-subprocess';
import { ansiToHtml } from './ansi-to-html';
import { readSettings } from './config';
import {
  contextLevel,
  quotaLevel,
  renderCountdownShort,
  renderPercent,
  formatTokens,
  type Level,
} from './bar';
import type { HudSnapshot, ProviderUsage } from './usage-data';

type View = 'dashboard' | 'terminal';

export class DetailPanelManager {
  private panel: vscode.WebviewPanel | null = null;
  private currentSnapshot: HudSnapshot | null = null;
  private currentView: View = 'dashboard';
  private rendering = false;

  showOrFocus(snapshot: HudSnapshot | null): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, false);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'claudeHudDetail',
        'Claude HUD',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: false },
      );
      panel.iconPath = new vscode.ThemeIcon('pulse');
      this.panel = panel;
      this.registerDispose(panel);
      panel.webview.html = this.shellHtml('Loading…');
    }
    this.currentSnapshot = snapshot;
    this.currentView = 'dashboard';
    void this.render();
  }

  onSnapshot(snapshot: HudSnapshot | null): void {
    this.currentSnapshot = snapshot;
    if (this.panel && this.panel.visible) {
      void this.render();
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  private registerDispose(panel: vscode.WebviewPanel): void {
    panel.onDidDispose(() => {
      this.panel = null;
      this.currentSnapshot = null;
      this.currentView = 'dashboard';
    });
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) {
        void this.render();
      }
    });
    // Switch between dashboard and terminal-HUD view via webview messages.
    panel.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.view === 'terminal') {
        this.currentView = 'terminal';
        void this.render();
      } else if (msg && msg.view === 'dashboard') {
        this.currentView = 'dashboard';
        void this.render();
      }
    });
  }

  private async render(): Promise<void> {
    const panel = this.panel;
    if (!panel || this.rendering) return;
    this.rendering = true;
    try {
      const snapshot = this.currentSnapshot;
      if (!snapshot || !snapshot.transcriptPath) {
        panel.webview.html = this.messageHtml(
          'No active Claude Code transcript found for this workspace.\n\nOpen a Claude Code session in this folder, then refresh.',
        );
        return;
      }

      if (this.currentView === 'terminal') {
        await this.renderTerminalView(panel, snapshot);
      } else {
        panel.webview.html = this.dashboardHtml(snapshot);
      }
    } catch (err) {
      const p = this.panel;
      if (p) {
        p.webview.html = this.messageHtml(`Unexpected error:\n\n${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.rendering = false;
    }
  }

  private async renderTerminalView(panel: vscode.WebviewPanel, snapshot: HudSnapshot): Promise<void> {
    const settings = readSettings();
    const entry = resolveHudEntry(settings.hudEntryPath);
    if (!entry) {
      panel.webview.html = this.messageHtml(
        'claude-hud is not installed, so the terminal HUD view is unavailable.\n\nThe dashboard card still works. Install claude-hud (/plugin install claude-hud) to enable this view.',
      );
      return;
    }
    const result = await renderHudOnce(entry, snapshot, 140);
    const body = ansiToHtml(result.output || '');
    panel.webview.html = this.terminalShellHtml(body);
  }

  // ── Dashboard card HTML (the primary view) ───────────────────────────────

  private dashboardHtml(s: HudSnapshot): string {
    const statusInfo = statusDescriptor(s);
    const u = s.usage;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude HUD</title>
<style>${DASHBOARD_CSS}</style>
</head>
<body>
<div class="card">
  <header class="card-header">
    <div class="brand">
      <span class="starburst">✲</span>
      <span class="model">${escapeHtml(s.modelLabel)}</span>
    </div>
    <span class="status" style="--status-color:${statusInfo.color}">${statusInfo.label}</span>
  </header>

  ${resetBlock(u)}
  ${spendBlock(s)}
  ${contextBlock(s)}

  <footer class="card-footer">
    <a href="#" id="switch-terminal">查看终端 HUD ›</a>
  </footer>
</div>
<script>
  document.getElementById('switch-terminal').addEventListener('click', (e) => {
    e.preventDefault();
    acquireVsCodeApi().postMessage({ view: 'terminal' });
  });
</script>
</body>
</html>`;
  }

  // ── Terminal-HUD shell (the alternate view) ──────────────────────────────

  private terminalShellHtml(body: string): string {
    const fontVar = 'var(--vscode-editor-font-family, "Cascadia Code", Menlo, Consolas, monospace)';
    const fg = 'var(--vscode-editor-foreground, #d4d4d4)';
    const bg = 'var(--vscode-editor-background, #1e1e1e)';
    const border = 'var(--vscode-panel-border, #444)';
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Claude HUD</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:${bg};color:${fg};}
  body{padding:12px 16px;box-sizing:border-box;}
  pre{font-family:${fontVar};font-size:var(--vscode-editor-font-size,13px);line-height:1.5;
      white-space:pre;overflow:auto;margin:0;background:transparent;border:1px solid ${border};
      border-radius:6px;padding:12px;}
  a{color:inherit;}
  .switch{font-family:var(--vscode-font-family,sans-serif);font-size:12px;margin-top:10px;}
  .switch a{opacity:0.7;text-decoration:none;cursor:pointer;}
</style></head>
<body>
<pre>${body}</pre>
<div class="switch"><a id="back-dashboard">‹ 返回仪表盘</a></div>
<script>
  document.getElementById('back-dashboard').addEventListener('click', () => {
    acquireVsCodeApi().postMessage({ view: 'dashboard' });
  });
</script>
</body></html>`;
  }

  private shellHtml(message: string): string {
    return this.messageHtml(message);
  }

  private messageHtml(message: string): string {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>${DASHBOARD_CSS}</style></head>
<body><div class="card"><div class="msg">${escapeHtml(message)}</div></div></body></html>`;
  }
}

// ── Dashboard sub-blocks ────────────────────────────────────────────────────

function resetBlock(u: ProviderUsage | null): string {
  const rows = [
    windowRow('5小时', u?.fiveHourPercent ?? null, u?.fiveHourResetAt ?? null, 'coral'),
    windowRow('每周', u?.sevenDayPercent ?? null, u?.sevenDayResetAt ?? null, 'coral'),
    windowRow('每月', null, null, 'coral'),
  ];
  return `  <section class="block">
    <h3>计划重置</h3>
    <div class="windows">${rows.join('')}</div>
  </section>`;
}

function windowRow(label: string, percent: number | null, resetAt: Date | null, accent: string): string {
  const pct = percent ?? 0;
  const level = quotaLevel(percent);
  const countdown = renderCountdownShort(resetAt);
  const showData = percent !== null;
  return `    <div class="window">
      <div class="window-head">
        <span class="window-label">${levelDot(level)} ${escapeHtml(label)}</span>
        <span class="window-pct">${showData ? renderPercent(percent) : '—'}</span>
      </div>
      <div class="bar-track"><div class="bar-fill ${accent}" style="width:${showData ? pct : 0}%"></div></div>
      <div class="window-reset">${showData ? `重置 ${escapeHtml(countdown)}` : '不可用'}</div>
    </div>`;
}

function spendBlock(s: HudSnapshot): string {
  const cost = s.sessionCostYuan !== null ? `≈¥${s.sessionCostYuan.toFixed(2)}` : '—';
  const tok = s.sessionTokens;
  const breakdown = tok
    ? `${formatTokens(tok.inputTokens)} in · ${formatTokens(tok.outputTokens)} out · ${formatTokens(tok.cacheCreationTokens)} cache`
    : '—';
  return `  <section class="block">
    <h3>积分与支出</h3>
    <div class="kv"><span>会话成本</span><span class="value">${cost}</span></div>
    <div class="kv muted"><span>Token 明细</span><span>${breakdown}</span></div>
    <div class="kv muted"><span>余额</span><span>—</span></div>
    <div class="kv muted"><span>月支出</span><span>—</span></div>
  </section>`;
}

function contextBlock(s: HudSnapshot): string {
  const pct = s.contextPercent ?? 0;
  const show = s.contextPercent !== null;
  const level = contextLevel(s.contextPercent);
  const used = s.contextTokens
    ? formatTokens(s.contextTokens.inputTokens + s.contextTokens.cacheCreationTokens + s.contextTokens.cacheReadTokens)
    : '—';
  return `  <section class="block">
    <h3>上下文</h3>
    <div class="window">
      <div class="window-head">
        <span class="window-label">${levelDot(level)} 用量</span>
        <span class="window-pct">${show ? renderPercent(s.contextPercent) : '—'}</span>
      </div>
      <div class="bar-track"><div class="bar-fill cyan" style="width:${show ? pct : 0}%"></div></div>
      <div class="window-reset">${used} / ${formatTokens(s.windowSize)}</div>
    </div>
  </section>`;
}

function levelDot(level: Level): string {
  const color = level === 'critical' ? '#ff5c5c' : level === 'warn' ? '#f0ad4e' : '#4ec9b0';
  return `<span class="dot" style="background:${color}"></span>`;
}

function statusDescriptor(s: HudSnapshot): { label: string; color: string } {
  if (s.snapshotStatus === 'stale') return { label: '快照过期', color: '#f0ad4e' };
  if (s.snapshotStatus === 'missing') return { label: '无快照', color: '#888' };
  const u = s.usage;
  const five = u?.fiveHourPercent ?? null;
  const seven = u?.sevenDayPercent ?? null;
  if ((five ?? 0) >= 90 || (seven ?? 0) >= 90) return { label: '已达上限', color: '#ff5c5c' };
  if ((five ?? 0) >= 75 || (seven ?? 0) >= 75) return { label: '接近上限', color: '#f0ad4e' };
  return { label: '正常', color: '#4ec9b0' };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Dashboard CSS — palette matched to the reference design ─────────────────
// Card: deep neutral; bars: cyan (context) + coral (usage); muted secondary text.
const DASHBOARD_CSS = `
  :root { color-scheme: dark; }
  html, body {
    margin: 0; padding: 0; min-height: 100%;
    background: var(--vscode-editor-background, #121214);
    color: #e4e4e7;
    font-family: var(--vscode-font-family, -apple-system, "Segoe UI", sans-serif);
    font-size: 13px;
  }
  body { display: flex; justify-content: center; padding: 24px; box-sizing: border-box; }
  .card {
    width: 100%; max-width: 420px;
    background: #1a1a1e;
    border: 1px solid #2a2a30;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    overflow: hidden;
  }
  .card-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid #2a2a30;
  }
  .brand { display: flex; align-items: center; gap: 8px; }
  .starburst { color: #d97757; font-size: 16px; line-height: 1; }
  .model { font-weight: 600; font-size: 14px; color: #f0f0f2; }
  .status {
    font-size: 12px; font-weight: 500;
    color: var(--status-color, #4ec9b0);
    display: inline-flex; align-items: center; gap: 5px;
  }
  .status::before {
    content: ""; width: 7px; height: 7px; border-radius: 50%;
    background: var(--status-color, #4ec9b0);
  }
  .block { padding: 14px 16px; border-bottom: 1px solid #2a2a30; }
  .block:last-of-type { border-bottom: none; }
  .block h3 {
    margin: 0 0 10px 0; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; color: #8a8a92;
  }
  .windows { display: flex; flex-direction: column; gap: 12px; }
  .window { display: flex; flex-direction: column; gap: 4px; }
  .window-head { display: flex; justify-content: space-between; align-items: center; }
  .window-label { color: #c8c8cc; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
  .window-pct { color: #f0f0f2; font-weight: 600; font-variant-numeric: tabular-nums; font-size: 12px; }
  .bar-track {
    height: 6px; background: #2e2e34; border-radius: 3px; overflow: hidden; margin-top: 2px;
  }
  .bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
  .bar-fill.cyan { background: #00bfff; box-shadow: 0 0 8px rgba(0,191,255,0.4); }
  .bar-fill.coral { background: #ff6347; box-shadow: 0 0 8px rgba(255,99,71,0.4); }
  .window-reset { font-size: 11px; color: #7a7a82; margin-top: 1px; }
  .kv {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 0; font-size: 12px;
  }
  .kv .value { font-weight: 600; color: #f0f0f2; font-variant-numeric: tabular-nums; }
  .kv.muted, .kv.muted .value { color: #8a8a92; font-weight: 400; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }
  .card-footer { padding: 10px 16px; text-align: right; }
  .card-footer a {
    color: #6a9955; font-size: 11px; text-decoration: none; cursor: pointer; opacity: 0.8;
  }
  .card-footer a:hover { opacity: 1; }
  .msg { padding: 24px 16px; color: #8a8a92; white-space: pre-wrap; line-height: 1.6; font-size: 12px; }
`;
