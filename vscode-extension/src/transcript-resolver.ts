// Locates the "active" Claude Code session transcript for a given workspace.
//
// Claude Code stores one JSONL transcript per session under
//   ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
// where <encoded-cwd> is the session's working directory with every
// non-[A-Za-z0-9] character replaced by '-' (verified empirically against the
// local projects directory, e.g. "C:\\Users\\xucong\\...\\claude-hud" ->
// "C--Users-xucong--claude-plugins-marketplaces-claude-hud").
//
// We cannot read the *currently selected* session from inside this extension
// (that state lives in Claude Code's closed webview), so the heuristic is: the
// most recently modified .jsonl under the encoded project dir is the live one.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProjectsDir } from './claude-config-dir';

/**
 * Encode an absolute cwd the same way Claude Code names project dirs.
 * Every character outside [A-Za-z0-9] becomes a single '-'.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export interface ResolvedTranscript {
  /** Absolute path to the chosen .jsonl file. */
  transcriptPath: string;
  /** The encoded project directory name. */
  projectDir: string;
}

/**
 * Resolve the most recently modified transcript JSONL for a workspace folder.
 * Returns null if the project dir does not exist or contains no transcripts.
 */
export function resolveActiveTranscript(workspaceFolder: string): ResolvedTranscript | null {
  const projectsDir = getProjectsDir();
  const encoded = encodeProjectDir(workspaceFolder);
  const projectDir = path.join(projectsDir, encoded);

  let entries: string[];
  try {
    entries = fs.readdirSync(projectDir);
  } catch {
    // Project dir missing: no Claude Code sessions for this workspace yet.
    return null;
  }

  let best: { file: string; mtime: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) {
      continue;
    }
    const full = path.join(projectDir, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) {
        continue;
      }
      if (!best || stat.mtimeMs > best.mtime) {
        best = { file: full, mtime: stat.mtimeMs };
      }
    } catch {
      // Stat failed for one entry; skip it and keep scanning.
    }
  }

  if (!best) {
    return null;
  }
  return { transcriptPath: best.file, projectDir: encoded };
}
