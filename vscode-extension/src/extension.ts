// Entry point. Wires up the status bar manager, the detail panel, and the three
// contributed commands. The status bar is the single source of periodic refresh;
// the detail panel rides on its onDidUpdate event so we have one timer.
import * as vscode from 'vscode';
import { StatusBarManager } from './status-bar';
import { DetailPanelManager } from './detail-webview';
import { readSettings } from './config';

let statusBar: StatusBarManager | null = null;
let detail: DetailPanelManager | null = null;

export function activate(context: vscode.ExtensionContext): void {
  statusBar = new StatusBarManager();
  detail = new DetailPanelManager();

  // Forward status bar snapshots to the detail panel. The panel ignores ticks
  // while hidden, so this is effectively free unless the panel is open.
  context.subscriptions.push(
    statusBar.onDidUpdate((snapshot) => detail?.onSnapshot(snapshot)),
  );

  // claudeHud.showDetail — open/focus the panel, seeded with the latest snapshot.
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeHud.showDetail', () => {
      detail?.showOrFocus(statusBar?.latest ?? null);
    }),
  );

  // claudeHud.refresh — force an immediate refresh cycle.
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeHud.refresh', () => {
      statusBar?.refreshNow();
    }),
  );

  // claudeHud.selectProvider — pick which provider snapshot to read.
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeHud.selectProvider', async () => {
      const items: (vscode.QuickPickItem & { value: string })[] = [
        { label: 'Auto (probe all)', value: 'auto' },
        { label: 'GLM', value: 'glm' },
        { label: 'MiniMax', value: 'minimax' },
        { label: 'Alibaba', value: 'alibaba' },
        { label: 'Kimi', value: 'kimi' },
      ];
      const current = readSettings().provider;
      const picked = await vscode.window.showQuickPick(items, {
        title: 'Claude HUD: Usage provider',
        placeHolder: `Current: ${current}`,
      });
      if (picked) {
        await vscode.workspace.getConfiguration('claudeHud').update(
          'provider',
          picked.value,
          vscode.ConfigurationTarget.Global,
        );
        statusBar?.refreshNow();
      }
    }),
  );

  // Restart the refresh loop when relevant settings (interval, etc.) change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeHud')) {
        statusBar?.start();
      }
    }),
  );

  context.subscriptions.push(statusBar);
  context.subscriptions.push(detail);

  statusBar.start();
}

export function deactivate(): void {
  statusBar?.dispose();
  detail?.dispose();
  statusBar = null;
  detail = null;
}
