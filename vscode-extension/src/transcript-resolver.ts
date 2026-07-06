// Locates the "active" Claude Code session transcript for a given workspace.
//
// Claude Code stores one JSONL transcript per session under
//   ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
// where <encoded-cwd> is the session's working directory with every
// non-[A-Za-z0-9] character replaced by '-'.
//
// We cannot read the *currently selected* session from inside this extension,
// so the heuristic is: the most recently modified .jsonl under the matching
// project dir is the live one.
//
// Path matching is defensive: VSCode's workspaceFolder.uri.fsPath may differ
// from the cwd Claude Code used to create the session (drive-letter casing,
// trailing separators, junctions, UNC forms). We therefore try, in order:
//   1. exact encoded match
//   2. case-insensitive encoded match (Windows)
//   3. the project dir whose decoded form ends with the workspace's basename
//   4. the globally most-recent transcript across all project dirs (last resort)
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

/** Decode an encoded project dir name back to an approximate cwd (for display / fuzzy match). */
function decodeProjectDir(encoded: string): string {
  // Lossy: '-' was both separator and any punctuation, so we can't reconstruct
  // exactly. Good enough for a basename/contains comparison.
  return encoded.replace(/-/g, path.sep);
}

export interface ResolvedTranscript {
  /** Absolute path to the chosen .jsonl file. */
  transcriptPath: string;
  /** The encoded project directory name that matched. */
  projectDir: string;
  /**
   * How the match was found. Useful for the detail panel to explain a
   * surprising choice. Values: 'exact' | 'case-insensitive' | 'basename' | 'global-newest' | 'none'.
   */
  matchStrategy: 'exact' | 'case-insensitive' | 'basename' | 'global-newest' | 'none';
}

function newestJsonlIn(dir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let best: { file: string; mtime: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      if (!best || stat.mtimeMs > best.mtime) {
        best = { file: full, mtime: stat.mtimeMs };
      }
    } catch {
      // skip unreadable entries
    }
  }
  return best ? best.file : null;
}

/**
 * Globally newest .jsonl across every project dir. Last-resort fallback so the
 * HUD still shows *something* when the workspace path can't be matched at all.
 */
function globalNewestTranscript(): { transcriptPath: string; projectDir: string } | null {
  const projectsDir = getProjectsDir();
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(projectsDir);
  } catch {
    return null;
  }
  let best: { transcriptPath: string; projectDir: string; mtime: number } | null = null;
  for (const pd of projectDirs) {
    const fullPd = path.join(projectsDir, pd);
    try {
      if (!fs.statSync(fullPd).isDirectory()) continue;
    } catch {
      continue;
    }
    const file = newestJsonlIn(fullPd);
    if (!file) continue;
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (!best || mtime > best.mtime) {
        best = { transcriptPath: file, projectDir: pd, mtime };
      }
    } catch {
      // skip
    }
  }
  return best ? { transcriptPath: best.transcriptPath, projectDir: best.projectDir } : null;
}

/**
 * Resolve the active transcript JSONL for a workspace folder using a layered
 * fallback. Always returns a result if ANY transcript exists on the machine,
 * so the HUD never shows "no session" when Claude Code has clearly been used.
 */
export function resolveActiveTranscript(workspaceFolder: string): ResolvedTranscript | null {
  const projectsDir = getProjectsDir();

  // 1 & 2: exact / case-insensitive encoded match.
  const encoded = encodeProjectDir(workspaceFolder);
  const exactDir = path.join(projectsDir, encoded);
  const candidateDirs: { dir: string; name: string; strategy: ResolvedTranscript['matchStrategy'] }[] = [];
  if (fs.existsSync(exactDir)) {
    candidateDirs.push({ dir: exactDir, name: encoded, strategy: 'exact' });
  } else {
    // Case-insensitive scan (Windows). readdir is bounded (one entry per project).
    let all: string[];
    try {
      all = fs.readdirSync(projectsDir);
    } catch {
      all = [];
    }
    const ci = all.find((d) => d.toLowerCase() === encoded.toLowerCase());
    if (ci) {
      candidateDirs.push({ dir: path.join(projectsDir, ci), name: ci, strategy: 'case-insensitive' });
    }
  }

  for (const cand of candidateDirs) {
    const file = newestJsonlIn(cand.dir);
    if (file) {
      return { transcriptPath: file, projectDir: cand.name, matchStrategy: cand.strategy };
    }
  }

  // 3: basename match — a project dir whose decoded form ends with the
  // workspace's final path segment. Handles junctions/shortcuts where the
  // encoded prefix differs but the leaf folder name is the same.
  const basename = path.basename(workspaceFolder.replace(/[\\/]+$/, ''));
  if (basename) {
    let all: string[];
    try {
      all = fs.readdirSync(projectsDir);
    } catch {
      all = [];
    }
    const decodedSuffix = basename.replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
    const byBasename = all.filter((d) => d.toLowerCase().endsWith(decodedSuffix));
    // newest among those
    let bestDir: { dir: string; name: string; mtime: number } | null = null;
    for (const pd of byBasename) {
      const fullPd = path.join(projectsDir, pd);
      const file = newestJsonlIn(fullPd);
      if (!file) continue;
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (!bestDir || mtime > bestDir.mtime) {
          bestDir = { dir: fullPd, name: pd, mtime };
        }
      } catch {
        // skip
      }
    }
    if (bestDir) {
      const file = newestJsonlIn(bestDir.dir);
      if (file) {
        return { transcriptPath: file, projectDir: bestDir.name, matchStrategy: 'basename' };
      }
    }
  }

  // 4: global newest — last resort.
  const g = globalNewestTranscript();
  if (g) {
    return { transcriptPath: g.transcriptPath, projectDir: g.projectDir, matchStrategy: 'global-newest' };
  }

  return null;
}

/** Exposed for diagnostics: list all project dirs (encoded names) under ~/.claude/projects. */
export function listProjectDirs(): string[] {
  try {
    return fs.readdirSync(getProjectsDir());
  } catch {
    return [];
  }
}

export { decodeProjectDir };
