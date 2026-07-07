# Claude HUD for VS Code

Claude HUD for VS Code: Claude Code context and usage, right in your status bar.

A standalone VS Code extension that brings [claude-hud](https://github.com/tsungseu/claude-hud-advanced) into the editor: a live, always-visible readout of your current session's context-window fill and provider usage, with a click-through panel for the full picture.

- **Status bar at a glance:** context fill and usage percentages with progress bars, refreshed every couple of seconds. The leading icon reflects status (`$(pulse)` normal, `$(warning)` near limit, `$(error)` at limit, `$(clock)` snapshot stale).
- **Hover for the dashboard:** hovering the status bar shows a popover-style card with three blocks — plan reset windows (5h / weekly / monthly + countdowns), credits & spend (session cost estimate), and context usage. Fields the provider doesn't expose (monthly window, balance, monthly spend) show `—`.
- **Click for the dashboard:** opens a styled usage card — plan reset windows, credits & spend, context usage, and a 30-day daily token usage bar chart (single-color totals per day with a Y axis + gridlines). Updated live via push.
- **Works with your provider:** reads usage snapshots from GLM, MiniMax, Alibaba, and Kimi coding plans (the quota pollers that ship with claude-hud), plus context from the session transcript.
- **Session cost estimate:** accumulates tokens across the session transcript and multiplies by a per-model pricing table (`claudeHud.pricing`) to estimate spend in ¥. Built-in defaults cover common GLM models; override with your plan's rates for accuracy.
- **Auto-detects your context window:** picks up `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and the model id suffix (e.g. `glm-5.2[1m]` → 1M), so the percentage is right for your plan.

## Requirements

- [Claude Code](https://claude.com/claude-code) with at least one session in the workspace (the extension reads the session transcript under `~/.claude/projects/`).
- VS Code 1.85.0 or higher.

## Install

```bash
cd vscode-extension
npm install
npm run package
code --install-extension claude-hud-vscode-0.4.0.vsix
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
| `claudeHud.pricing` | `{}` | Per-model token pricing in ¥/M tokens, for session cost estimation. Keys are model ids (e.g. `"glm-5.2"`); each value is `{ input, output, cache }`. Built-in defaults cover common GLM models. |

## Commands

- **Claude HUD: Show Detail Panel** — open the usage dashboard card (also triggered by clicking the status bar).
- **Claude HUD: Refresh Now** — force an immediate refresh.
- **Claude HUD: Select Usage Provider** — pick which provider snapshot to read.

## How it works

This extension does **not** hook into the official Claude Code webview (that surface is closed to third parties). Instead it runs alongside it:

- **Context %** is computed from the last assistant turn's token usage in the session transcript (input + cache_creation + cache_read), divided by the context window size. It's an approximation — it can drift from Claude Code's native `used_percentage` right after a `/compact` or during parallel subagents.
- **Usage %** comes straight from the provider snapshot file the claude-hud quota pollers write (`~/.claude/glm-usage-snapshot.json`, etc.). Anthropic's native `rate_limits` isn't reachable outside the statusline stdin, so for Anthropic plans the usage bar may be empty — use a provider with a poller.
- The **dashboard** is fully self-contained: it reads the transcript + provider snapshot directly and renders its own styled card (no subprocess, no dependency on claude-hud being installed). The daily chart buckets assistant-turn tokens by UTC day across the workspace's last 30 days of transcripts (input + output + cache combined into one total per day; idle days render as zero-height bars so the timeline is unbroken).

## Notes & troubleshooting

- **No status bar item after install?** Reload the window — the extension activates on startup.
- **"No active transcript"?** Open a Claude Code session in the current workspace first. The resolver falls back to the globally most-recent transcript as a last resort, so it should rarely say this.
- **EPERM on `System Volume Information`?** That's VS Code's built-in Git extension scanning a drive-root workspace (e.g. `D:\`), not this extension. Open a real subfolder instead of a drive root.
- The extension icon uses Anthropic's Claude starburst mark; it's a derivative asset for local use, not for republishing to a public marketplace.

## License

MIT
