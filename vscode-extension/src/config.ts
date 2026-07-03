// Typed accessors for the extension's configuration settings.
import * as vscode from 'vscode';

const SECTION = 'claudeHud';

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export interface HudSettings {
  contextWindowSize: number;
  modelLabel: string;
  hudEntryPath: string;
  snapshotFreshnessMs: number;
  refreshIntervalMs: number;
  provider: 'auto' | 'glm' | 'minimax' | 'alibaba' | 'kimi';
}

export function readSettings(): HudSettings {
  const c = cfg();
  return {
    // 0 = auto-detect from CLAUDE_CODE_AUTO_COMPACT_WINDOW / model id suffix.
    contextWindowSize: c.get<number>('contextWindowSize', 0),
    modelLabel: c.get<string>('modelLabel', ''),
    hudEntryPath: c.get<string>('hudEntryPath', ''),
    snapshotFreshnessMs: c.get<number>('snapshotFreshnessMs', 600_000),
    refreshIntervalMs: c.get<number>('refreshIntervalMs', 2000),
    provider: c.get<'auto' | 'glm' | 'minimax' | 'alibaba' | 'kimi'>('provider', 'auto'),
  };
}
