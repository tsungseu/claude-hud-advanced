# Claude HUD for VS Code

Track Claude Code context and usage right in your status bar — no terminal needed.

A standalone VS Code extension that brings [claude-hud](https://github.com/tsungseu/claude-hud-advanced) into the editor: a live, always-visible readout of your current session's context-window fill and provider usage, with a click-through panel for the full picture.

- **Status bar at a glance:** context fill and usage percentages with progress bars, refreshed every couple of seconds.
- **Click for the full HUD:** opens a panel rendering the complete claude-hud statusline — tools, agents, todos, git, cost — in the same colors you see in the terminal.
- **Works with your provider:** reads usage snapshots from GLM, MiniMax, Alibaba, and Kimi coding plans (the quota pollers that ship with claude-hud), plus context from the session transcript.
- **Auto-detects your context window:** picks up `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and the model id suffix (e.g. `glm-5.2[1m]` → 1M), so the percentage is right for your plan.

## Requirements

- [Claude Code](https://claude.com/claude-code) with at least one session in the workspace (the extension reads the session transcript under `~/.claude/projects/`).
- For the **full HUD panel**, install the [claude-hud](https://github.com/tsungseu/claude-hud-advanced) plugin (`/plugin install claude-hud`). The status bar summary works without it.
- VS Code 1.85.0 or higher.

## Install

```bash
cd vscode-extension
npm install
npm run package
code --install-extension claude-hud-vscode-0.2.0.vsix
```

Then **reload the window** (`Developer: Reload Window`). The status bar item appears on the right; click it to open the detail panel.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `claudeHud.contextWindowSize` | `0` | Context window size in tokens. `0` = auto-detect from `CLAUDE_CODE_AUTO_COMPACT_WINDOW` / model id suffix. |
| `claudeHud.modelLabel` | `""` | Override the model display name. Empty = inferred from settings. |
| `claudeHud.provider` | `"auto"` | Which provider usage snapshot to read (`auto` probes GLM/MiniMax/Alibaba/Kimi). |
| `claudeHud.refreshIntervalMs` | `2000` | Status bar refresh interval. |
| `claudeHud.snapshotFreshnessMs` | `600000` | Max age of a usage snapshot before it's considered stale. |
| `claudeHud.hudEntryPath` | `""` | Absolute path to claude-hud's `dist/index.js`. Empty = auto-detect the newest installed version. |

## Commands

- **Claude HUD: Show Detail Panel** — open the full HUD panel (also triggered by clicking the status bar).
- **Claude HUD: Refresh Now** — force an immediate refresh.
- **Claude HUD: Select Usage Provider** — pick which provider snapshot to read.

## How it works

This extension does **not** hook into the official Claude Code webview (that surface is closed to third parties). Instead it runs alongside it:

- **Context %** is computed from the last assistant turn's token usage in the session transcript (input + cache_creation + cache_read), divided by the context window size. It's an approximation — it can drift from Claude Code's native `used_percentage` right after a `/compact` or during parallel subagents.
- **Usage %** comes straight from the provider snapshot file the claude-hud quota pollers write (`~/.claude/glm-usage-snapshot.json`, etc.). Anthropic's native `rate_limits` isn't reachable outside the statusline stdin, so for Anthropic plans the usage bar may be empty — use a provider with a poller.
- The **detail panel** spawns claude-hud's `dist/index.js` with a reconstructed stdin, so it shows byte-for-byte the same HUD the terminal would.

## Notes & troubleshooting

- **No status bar item after install?** Reload the window — the extension activates on startup.
- **"No active transcript"?** Open a Claude Code session in the current workspace first. The resolver falls back to the globally most-recent transcript as a last resort, so it should rarely say this.
- **EPERM on `System Volume Information`?** That's VS Code's built-in Git extension scanning a drive-root workspace (e.g. `D:\`), not this extension. Open a real subfolder instead of a drive root.
- The extension icon uses Anthropic's Claude starburst mark; it's a derivative asset for local use, not for republishing to a public marketplace.

## License

MIT
