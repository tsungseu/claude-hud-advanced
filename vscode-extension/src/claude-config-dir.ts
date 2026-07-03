// Ported from claude-hud src/claude-config-dir.ts so the extension resolves the
// same ~/.claude directory (honoring CLAUDE_CONFIG_DIR) the plugin itself uses.
import * as path from 'node:path';
import * as os from 'node:os';

function expandHomeDirPrefix(inputPath: string, homeDir: string): string {
  if (inputPath === '~') {
    return homeDir;
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

export function getClaudeConfigDir(): string {
  const homeDir = os.homedir();
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!envConfigDir) {
    return path.join(homeDir, '.claude');
  }
  return path.resolve(expandHomeDirPrefix(envConfigDir, homeDir));
}

/** Path to ~/.claude/settings.json (the global settings, not project-local). */
export function getClaudeSettingsPath(): string {
  return path.join(getClaudeConfigDir(), 'settings.json');
}

/** Directory holding per-project transcript JSONL files: ~/.claude/projects/<encoded-cwd>/*.jsonl */
export function getProjectsDir(): string {
  return path.join(getClaudeConfigDir(), 'projects');
}
