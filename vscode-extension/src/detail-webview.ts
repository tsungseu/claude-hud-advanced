// The click-through detail panel: renders claude-hud's full colored HUD in a
// webview. Re-renders by re-running dist/index.js whenever the status bar emits
// a fresh snapshot (same cadence), but only while the panel is visible.
import * as vscode from 'vscode';
import { renderHudOnce, resolveHudEntry } from './hud-subprocess';
import { ansiToHtml } from './ansi-to-html';
import { readSettings } from './config';
import type { HudSnapshot } from './usage-data';

export class DetailPanelManager {
  private panel: vscode.WebviewPanel | null = null;
  private currentEntry: string | null = null;
  private currentSnapshot: HudSnapshot | null = null;
  private rendering = false;

  showOrFocus(snapshot: HudSnapshot | null): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, false);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'claudeHudDetail',
        'Claude HUD',
        vscode.ViewColumn.Beside,
        {
          enableScripts: false,
          retainContextWhenHidden: false,
        },
      );
      panel.iconPath = new vscode.ThemeIcon('pulse');
      this.panel = panel;
      this.registerDispose(panel);
      // First paint with the static shell so the panel isn't blank during spawn.
      panel.webview.html = this.shellHtml('Loading HUD…');
    }
    this.currentSnapshot = snapshot;
    void this.render();
  }

  /** Called by the status bar on each refresh tick. */
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
    });
    // onDidChangeViewState fires on focus/visibility changes; re-render when
    // the panel becomes visible again (hidden panels are skipped in onSnapshot).
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) {
        void this.render();
      }
    });
  }

  private async render(): Promise<void> {
    const panel = this.panel;
    if (!panel || this.rendering) return;
    this.rendering = true;
    try {
      const settings = readSettings();
      const entry = resolveHudEntry(settings.hudEntryPath);
      this.currentEntry = entry;
      const snapshot = this.currentSnapshot;

      if (!snapshot || !snapshot.transcriptPath) {
        panel.webview.html = this.shellHtml(
          'No active Claude Code transcript found for this workspace.\n\n' +
            'Open a Claude Code session in this folder, then click the status bar to refresh.',
        );
        return;
      }

      if (!entry) {
        panel.webview.html = this.shellHtml(
          'claude-hud is not installed.\n\n' +
            'Install it (`/plugin install claude-hud`) or set "Claude HUD: Hud Entry Path" ' +
            'to the absolute path of claude-hud\'s dist/index.js.\n\n' +
            'The status bar summary still works without it.',
        );
        return;
      }

      // COLUMNS drives the HUD's line wrapping. Use a wide terminal so nothing
      // is truncated in the panel; the <pre> scrolls horizontally if needed.
      const columns = 140;
      const result = await renderHudOnce(entry, snapshot, columns);
      if (result.error && !result.output) {
        panel.webview.html = this.shellHtml(`HUD render failed:\n\n${result.error}`);
        return;
      }
      const body = ansiToHtml(result.output || '');
      panel.webview.html = this.shellHtml('', body);
    } catch (err) {
      const panel = this.panel;
      if (panel) {
        panel.webview.html = this.shellHtml(`Unexpected error:\n\n${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.rendering = false;
    }
  }

  /** Outer HTML shell with a themed monospace <pre>; messageOrHtml fills it. */
  private shellHtml(message: string, html?: string): string {
    const fontVar = 'var(--vscode-editor-font-family, "Cascadia Code", Menlo, Consolas, monospace)';
    const fg = 'var(--vscode-editor-foreground, #d4d4d4)';
    const bg = 'var(--vscode-editor-background, #1e1e1e)';
    const border = 'var(--vscode-panel-border, #444)';
    const content = html ?? escapeForPre(message);
    const title = this.currentEntry
      ? `claude-hud entry: ${escapeForPre(this.currentEntry)}`
      : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude HUD</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: ${bg}; color: ${fg}; }
  body { padding: 12px 16px; box-sizing: border-box; }
  pre {
    font-family: ${fontVar};
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.5;
    white-space: pre;
    overflow: auto;
    margin: 0;
    background: var(--vscode-textCodeBlock-background, transparent);
    border: 1px solid ${border};
    border-radius: 6px;
    padding: 12px;
  }
  a { color: inherit; }
  .meta { font-family: var(--vscode-font-family, sans-serif); font-size: 11px; opacity: 0.6; margin-top: 8px; }
</style>
</head>
<body>
<pre>${content}</pre>
${title ? `<div class="meta">${title}</div>` : ''}
</body>
</html>`;
  }
}

function escapeForPre(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
