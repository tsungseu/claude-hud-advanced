// Resolves claude-hud's dist/index.js and runs it as a one-shot subprocess,
// feeding it a *synthesized* stdin JSON built from what this extension can read
// locally (transcript + provider snapshot). The subprocess does all the real
// rendering (tools/agents/todos/git/cost lines from the transcript, colored bars)
// and returns ANSI-colored stdout we pass to the webview.
//
// This is the same dist/index.js Claude Code itself invokes as its statusLine,
// so the detail panel shows byte-for-byte the same HUD the terminal would.
//
// Synthesized stdin follows claude-hud's StdinData contract (src/types.ts:4-53).
// We fill what we can measure (context_window.current_usage from the last
// assistant turn) and convert the provider snapshot into rate_limits so the
// usage bar renders even when claude-hud's own externalUsagePath isn't set.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { getClaudeConfigDir } from './claude-config-dir';
import type { HudSnapshot } from './usage-data';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * Locate the newest installed claude-hud dist/index.js via version-glob,
 * mirroring commands/setup.md. Falls back to an explicit override path.
 * Returns null if nothing is found.
 */
export function resolveHudEntry(overridePath: string): string | null {
  const trimmed = overridePath.trim();
  if (trimmed) {
    try {
      if (fs.statSync(trimmed).isFile()) {
        return trimmed;
      }
    } catch {
      // fall through to auto-detect
    }
  }

  const cacheRoot = path.join(getClaudeConfigDir(), 'plugins', 'cache');
  let marketDirs: string[];
  try {
    marketDirs = fs.readdirSync(cacheRoot);
  } catch {
    return null;
  }

  let bestVersion = '';
  let bestDir = '';
  for (const market of marketDirs) {
    const pluginDir = path.join(cacheRoot, market, 'claude-hud');
    let versions: string[];
    try {
      versions = fs.readdirSync(pluginDir);
    } catch {
      continue;
    }
    for (const v of versions) {
      if (!SEMVER_RE.test(v)) continue;
      const full = path.join(pluginDir, v);
      try {
        if (!fs.statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      // Highest semver wins (string compare works for x.y.z zero-padded; do a
      // numeric compare to be safe against e.g. 0.10.0 vs 0.9.0).
      if (bestVersion === '' || compareSemver(v, bestVersion) > 0) {
        const entry = path.join(full, 'dist', 'index.js');
        try {
          if (fs.statSync(entry).isFile()) {
            bestVersion = v;
            bestDir = entry;
          }
        } catch {
          // version dir exists but dist/index.js missing; skip.
        }
      }
    }
  }
  return bestDir || null;
}

function compareSemver(a: string, b: string): number {
  const [a1, a2, a3] = a.split('.').map((n) => Number.parseInt(n, 10));
  const [b1, b2, b3] = b.split('.').map((n) => Number.parseInt(n, 10));
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

/**
 * Build the StdinData JSON to pipe into dist/index.js from our local snapshot.
 * Keeps claude-hud's parser happy: context_window shape, optional rate_limits
 * from the provider snapshot, and the real transcript_path so it can render
 * tools/agents/todos.
 */
export function buildSyntheticStdin(snapshot: HudSnapshot): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stdin: any = {
    cwd: snapshot.workspaceFolder || undefined,
    model: { display_name: snapshot.modelLabel },
    transcript_path: snapshot.transcriptPath ?? undefined,
  };

  if (snapshot.contextTokens) {
    stdin.context_window = {
      context_window_size: snapshot.windowSize,
      current_usage: {
        input_tokens: snapshot.contextTokens.inputTokens,
        cache_creation_input_tokens: snapshot.contextTokens.cacheCreationTokens,
        cache_read_input_tokens: snapshot.contextTokens.cacheReadTokens,
        output_tokens: 0,
      },
    };
  } else if (snapshot.windowSize) {
    stdin.context_window = { context_window_size: snapshot.windowSize };
  }

  // Convert provider snapshot into Anthropic-style rate_limits so the usage bar
  // renders even without claude-hud's externalUsagePath configured.
  if (snapshot.usage) {
    const rate_limits: Record<string, { used_percentage: number | null; resets_at: number | null }> = {};
    if (snapshot.usage.fiveHourPercent !== null) {
      rate_limits.five_hour = {
        used_percentage: snapshot.usage.fiveHourPercent,
        resets_at: snapshot.usage.fiveHourResetAt
          ? Math.floor(snapshot.usage.fiveHourResetAt.getTime() / 1000)
          : null,
      };
    }
    if (snapshot.usage.sevenDayPercent !== null) {
      rate_limits.seven_day = {
        used_percentage: snapshot.usage.sevenDayPercent,
        resets_at: snapshot.usage.sevenDayResetAt
          ? Math.floor(snapshot.usage.sevenDayResetAt.getTime() / 1000)
          : null,
      };
    }
    if (Object.keys(rate_limits).length > 0) {
      stdin.rate_limits = rate_limits;
    }
  }

  return JSON.stringify(stdin);
}

export interface HudRenderResult {
  /** ANSI-colored text from dist/index.js stdout. Empty string on failure. */
  output: string;
  /** Non-empty if the subprocess failed or claude-hud entry was not found. */
  error: string | null;
}

/**
 * Spawn dist/index.js with the synthesized stdin, capture stdout.
 * Resolves within a hard timeout so a hung HUD never blocks the panel.
 */
export function renderHudOnce(
  entryPath: string,
  snapshot: HudSnapshot,
  columns: number,
  timeoutMs = 5000,
): Promise<HudRenderResult> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (r: HudRenderResult) => {
      if (resolved) return;
      resolved = true;
      resolve(r);
    };

    const env = { ...process.env, COLUMNS: String(columns), CLAUDE_HUD_DISABLE: '' };
    let child;
    try {
      child = spawn(process.execPath, [entryPath], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      done({ output: '', error: `Failed to spawn HUD process: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      done({ output: stdout, error: `HUD timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      done({ output: '', error: `HUD process error: ${err.message}` });
    });
    child.on('close', () => {
      clearTimeout(timer);
      // claude-hud prints a single error line prefixed "[claude-hud] Error:" on
      // failure; surface that rather than empty output.
      const trimmed = stdout.trim();
      if (!trimmed && stderr.trim()) {
        done({ output: '', error: stderr.trim().split('\n')[0] || 'HUD produced no output' });
        return;
      }
      done({ output: stdout, error: trimmed ? null : 'HUD produced no output' });
    });

    try {
      child.stdin.write(buildSyntheticStdin(snapshot));
      child.stdin.end();
    } catch {
      // stdin write failed; let the timeout/close handler report it.
    }
  });
}
