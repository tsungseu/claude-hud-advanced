# Claude HUD

A Claude Code plugin that shows what's happening — context usage, active tools, running agents, and todo progress. Always visible below your input.

[![License](https://img.shields.io/github/license/tsungseu/claude-hud-advanced?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/tsungseu/claude-hud-advanced)](https://github.com/tsungseu/claude-hud-advanced/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

> 🌐 English | [中文文档](README.zh.md)

## Install

Inside a Claude Code instance, run the following commands:

**Step 1: Add the marketplace**
```
/plugin marketplace add tsungseu/claude-hud-advanced
```

**Step 2: Install the plugin**

<details>
<summary><strong>⚠️ Linux users: Click here first</strong></summary>

On Linux, `/tmp` is often a separate filesystem (tmpfs), which causes plugin installation to fail with:
```
EXDEV: cross-device link not permitted
```

**Fix**: Set TMPDIR before installing:
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude
```

Then run the install command below in that session. This is a [Claude Code platform limitation](https://github.com/anthropics/claude-code/issues/14799).

</details>

```
/plugin install claude-hud
```

After that, reload plugins:

```
/reload-plugins
```


**Step 3: Configure the statusline**
```
/claude-hud:setup
```

<details>
<summary><strong>⚠️ Windows users: Click here if setup says no JavaScript runtime was found</strong></summary>

On Windows, Node.js LTS is the supported runtime for Claude HUD setup. If setup says no JavaScript runtime was found, install Node.js for your shell first:
```powershell
winget install OpenJS.NodeJS.LTS
```
Then restart your shell and run `/claude-hud:setup` again.

</details>

Done! Restart Claude Code to load the new statusLine config, then the HUD will appear.

On Windows, make that a full Claude Code restart after setup writes the new `statusLine` config.

---

## What is Claude HUD?

Claude HUD gives you better insights into what's happening in your Claude Code session.

| What You See | Why It Matters |
|--------------|----------------|
| **Project path** | Know which project you're in (configurable 1-3 directory levels) |
| **Context health** | Know exactly how full your context window is before it's too late |
| **Tool activity** | Watch Claude read, edit, and search files as it happens |
| **Agent tracking** | See which subagents are running and what they're doing |
| **Todo progress** | Track task completion in real-time |

## What You See

### Default (2 lines)
```
[Fable 5] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
```
- **Line 1** — Model, provider label when positively identified (for example `Bedrock`, `Vertex`), project path, git branch
- **Line 2** — Context bar (green → yellow → red) and usage rate limits

### Optional lines (enable via `/claude-hud:configure`)
```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← Tools activity
◐ explore [haiku]: Finding auth code (2m 15s)    ← Agent status
▸ Fix authentication bug (2/5)                   ← Todo progress
```

---

## How It Works

Claude HUD uses Claude Code's native **statusline API** — no separate window, no tmux required, works in any terminal.

```
Claude Code → stdin JSON → claude-hud → stdout → displayed in your terminal
           ↘ transcript JSONL (tools, agents, todos)
```

**Key features:**
- Native token data from Claude Code (not estimated)
- Scales with Claude Code's reported context window size, including newer 1M-context sessions
- Parses the transcript for tool/agent activity
- Updates every ~300ms

---

## Configuration

Customize your HUD anytime:

```
/claude-hud:configure
```

The guided flow handles layout, language, and common display toggles. Advanced overrides (custom colors, thresholds, `timeFormat`) are preserved there but set by editing the config file directly at `~/.claude/plugins/claude-hud/config.json`.

### Presets

| Preset | What's Shown |
|--------|--------------|
| **Full** | Everything enabled — tools, agents, todos, git, usage, duration |
| **Essential** | Activity lines + git status, minimal info clutter |
| **Minimal** | Core only — just model name and context bar |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `language` | `en` \| `zh` \| `zh-Hans` | `en` | HUD label language |
| `lineLayout` | string | `expanded` | `expanded` (multi-line) or `compact` (single line) |
| `pathLevels` | 1-3 | 1 | Directory levels in project path |
| `maxWidth` | number \| `null` | `null` | Fallback width when terminal detection fails |
| `forceMaxWidth` | boolean | false | Always use `maxWidth`, even if terminal is narrower |
| `elementOrder` | string[] | `["project","addedDirs","context","usage","promptCache","memory","environment","tools","skills","mcp","agents","todos","sessionTime"]` | Expanded-mode element order; omit entries to hide them |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | Expanded-mode line groups that share a line; `[]` disables merging |
| `gitStatus.enabled` | boolean | true | Show git branch |
| `gitStatus.showDirty` | boolean | true | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | boolean | false | Show `↑N ↓N` ahead/behind |
| `gitStatus.pushWarningThreshold` | number | 0 | Warning color for ahead count at ≥N (`0` off) |
| `gitStatus.pushCriticalThreshold` | number | 0 | Critical color for ahead count at ≥N (`0` off) |
| `gitStatus.showFileStats` | boolean | false | Show file change counts `!M +A ✘D ?U` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | `wrap` lets the git block flow onto its own line |
| `display.showModel` | boolean | true | Show model name `[Fabel]` |
| `display.showProvider` | boolean | false | Show provider label *before* the model, e.g. `[Bedrock \| Fabel]` |
| `display.providerName` | string | `""` | Explicit provider label for `showProvider`; falls back to auto-detection |
| `display.showAddedDirs` | boolean | true | Show `/add-dir` workspaces (e.g. `+sparkle`); max 5, basenames truncated to 24 chars |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` (next to project, `+name`) or `line` (separate `Added dirs:` row) |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | Context display format |
| `display.autoCompactWindow` | number \| `null` | `null` | Context % computed against this auto-compact window when set (matches `/context`) |
| `display.showConfigCounts` | boolean | false | Show CLAUDE.md, rules, MCPs, hooks counts |
| `display.showCost` | boolean | false | Show session cost (native `cost.total_cost_usd` w/ local estimate fallback) |
| `display.showOutputStyle` | boolean | false | Show active `outputStyle` as `style: <name>` |
| `display.showDuration` | boolean | false | Show session duration `⏱️ 5m` |
| `display.showSpeed` | boolean | false | Show output token speed `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | Show subscriber usage limits when available |
| `display.usageValue` | `percent` \| `remaining` | `percent` | Usage format: used or remaining |
| `display.usageBarEnabled` | boolean | true | Show usage as visual bar |
| `display.usageCompact` | boolean | false | Short text form `5h: 25% (1h 30m)`; overrides `usageBarEnabled` |
| `display.showResetLabel` | boolean | true | Show `resets in` prefix before countdowns |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | How usage-window time is shown |
| `display.sevenDayThreshold` | 0-100 | 80 | Show 7-day usage at ≥ threshold (`0` = always) |
| `display.externalUsagePath` | string | `""` | Absolute path to a local usage snapshot (see [Provider Bridges](#provider-usage-bridges)) |
| `display.externalUsageWritePath` | string | `""` | Write stdin rate_limits here for other local tools |
| `display.externalUsageFreshnessMs` | number | `300000` | Max snapshot age before it is ignored |
| `display.showTokenBreakdown` | boolean | true | Show token details at high context (85%+) |
| `display.showTools` | boolean | false | Show tools activity line |
| `display.showSkills` | boolean | false | Show active Skills |
| `display.showMcp` | boolean | false | Show active MCP servers |
| `display.toolNameMaxLength` | number | `0` | Max tool-name length (`0` = full) |
| `display.toolsMaxVisible` | number | `4` | Max completed tools shown (`0` = unlimited) |
| `display.showAgents` | boolean | false | Show agents activity line |
| `display.showTodos` | boolean | false | Show todos progress line |
| `display.showSessionName` | boolean | false | Show session slug/title from `/rename` |
| `display.showAdvisor` | boolean | false | Inline the `/advisor` model on the project line |
| `display.advisorOverride` | string | `""` | Manual advisor label override |
| `display.showSessionStartDate` | boolean | false | Show transcript session start timestamp |
| `display.showLastResponseAt` | boolean | false | Time since last assistant response |
| `display.showCompactions` | boolean | false | Count of context compactions this session |
| `display.showClaudeCodeVersion` | boolean | false | Show installed Claude Code version, e.g. `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | Show approximate system RAM usage (expanded only; may overstate real pressure) |
| `display.showPromptCache` | boolean | false | Show prompt cache countdown (hidden until first assistant response) |
| `display.promptCacheTtlSeconds` | number | `300` | Prompt cache TTL — `300` for Pro, `3600` for Max |
| `colors.*` | color | — | Color for the matching element: `context`, `usage`, `warning`, `usageWarning`, `critical`, `model`, `project`, `git`, `gitBranch`, `label`, `custom` |
| `colors.barFilled` / `colors.barEmpty` | string | `█` / `░` | Filled/empty progress-bar characters (single visible grapheme) |

Supported color values: `dim`, `red`, `green`, `yellow`, `magenta`, `cyan`, `brightBlue`, `brightMagenta`, a 256-color number (`0-255`), or hex (`#rrggbb`).

### Usage Limits

Usage display is **enabled by default** when Claude Code provides subscriber `rate_limits` on stdin (shown on line 2 alongside the context bar). It is not available for API-key-only sessions or for managed providers like Bedrock/Vertex (where billing lives elsewhere).

- `display.usageValue` — `percent` (used) or `remaining`
- `display.timeFormat` — countdown, wall-clock, elapsed span, or combinations
- `display.sevenDayThreshold` — weekly window appears above this (default 80; `0` always shows)
- `display.usageCompact` / `display.showResetLabel` — shorter text forms
- Free/weekly-only accounts render the weekly window alone (no ghost `5h: --`)

A fresh local snapshot at `display.externalUsagePath` can append a `balance_label`, or — if stdin `rate_limits` are missing — provide fallback usage windows entirely. This is how the provider bridges below feed usage into the HUD.

### Security Notes

ClaudeHUD is **local-only by design**: it reads the statusline JSON from stdin, the session transcript, selected `~/.claude` config files, and git metadata. It makes no network requests and calls no undocumented APIs. Cache files are written with private permissions on POSIX.

`--extra-cmd` is disabled unless `CLAUDE_HUD_ALLOW_EXTRA_CMD=1` is set in the HUD process environment. Treat it as arbitrary code execution — never use commands from untrusted sources.

### Example Configuration

```json
{
  "lineLayout": "expanded",
  "showSeparators": false,
  "language": "en",
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": false,
    "showFileStats": false
  },
  "display": {
    "showModel": true,
    "showContextBar": true,
    "showTools": true,
    "showSkills": true,
    "showMcp": true,
    "showAgents": true,
    "showTodos": true,
    "showProject": true,
    "showAddedDirs": true,
    "showUsage": true,
    "showOutputStyle": true,
    "showCompactions": true,
    "showAdvisor": true,
    "externalUsagePath": "C:/Users/.claude/<provider>-usage-snapshot.json"
  }
}
```

### Display Examples

**1 level (default):** `[Fabel] │ my-project git:(main)`

**2 levels:** `[Fabel] │ apps/my-project git:(main)`

**3 levels:** `[Fabel] │ dev/apps/my-project git:(main)`

**With dirty indicator:** `[Fabel] │ my-project git:(main*)`

**With ahead/behind:** `[Fabel] │ my-project git:(main ↑2 ↓1)`

**With file stats:** `[Fabel] │ my-project git:(main* !3 +1 ?2)`
- `!` = modified files, `+` = added/staged, `✘` = deleted, `?` = untracked
- Counts of 0 are omitted for cleaner display

### Disabling the HUD Temporarily

Set the `CLAUDE_HUD_DISABLE` environment variable — no need to edit `settings.json`:

```bash
CLAUDE_HUD_DISABLE=1 claude
```

---

## CN Model Provider Usage Bridges

When you run Claude Code through a **non-Anthropic provider proxy** (GLM/BigModel, MiniMax, Alibaba/Qwen, Kimi/Moonshot), the proxy does **not** emit Anthropic-style `rate_limits` on the statusline stdin, so the Usage line stays empty. Claude HUD ships a **bridge** for each: a standalone background poller that queries the vendor's quota API on a timer and writes a local snapshot the HUD reads.

### How it works

The bridge is **decoupled** — the short-lived statusline process (re-invoked every ~300ms) never makes network calls; it only reads a local JSON snapshot. A separate, long-lived poller daemon does all the API work:

```
┌──────────────────────┐  atomic JSON write  ┌─────────────────────────┐  read   ┌──────────────┐
│  Provider poller     │ ──────────────────> │ ~/.claude/<p>-snapshot  │ ──────> │ claude-hud   │
│  long-lived daemon   │                     │ .json  (0600)           │         │ statusline   │
│  polls vendor API    │                     │                         │         │ (renders bar)│
│  every ~5 min        │                     │  shared snapshot file   │         │              │
└──────────────────────┘                     └─────────────────────────┘         └──────────────┘
```

**Shared snapshot contract** — every poller writes (and the HUD reads) this shape:

```jsonc
{
  "updated_at": "2026-07-03T12:00:00Z",
  "five_hour": { "used_percentage": 0-100, "resets_at": "ISO8601" },   // the Usage bar
  "seven_day":  { "used_percentage": 0-100, "resets_at": "ISO8601" },  // optional weekly row
  "balance_label": "¥6.35"                                             // optional prepaid balance
}
```

The HUD treats the snapshot as valid only when fresh (`display.externalUsageFreshnessMs`, default 5 min) and with valid timestamps; relative/invalid JSON is ignored quietly. Pollers write **atomically** (temp file + `rename` + `0600` perms), so an API failure never overwrites a good snapshot with bad data — the next cycle recovers.

**Zero dependencies** — each poller is a single `.mjs` using only Node 18+ built-ins (`fs`, `os`, global `fetch`). No npm install, no extra runtime.

**API key auto-detection** (highest priority first):
1. Vendor env var (e.g. `GLM_API_KEY`)
2. `apiKey` in `src/providers/<name>/config.json` (copy from `config.example.json`)
3. Auto-detected from `~/.claude/settings.json` — `ANTHROPIC_AUTH_TOKEN` is reused **only when `ANTHROPIC_BASE_URL` points at that vendor**, so a real Anthropic credential is never leaked to a Chinese endpoint.

**Proxy-aware fetch** — Node's built-in `fetch` ignores `HTTP(S)_PROXY`. The shared `src/providers/shared/proxy-fetch.mjs` implements an HTTP CONNECT tunnel (with TLS over the socket and Basic proxy auth), honoring `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`.

**Auto-start** — `plugin.json` registers a `SessionStart` hook that runs each poller with `--ensure`. Using a PID file, `--ensure` launches a detached daemon only if one isn't already running (idempotent across sessions), then returns immediately so it never blocks session start. The daemon survives the session ending; after a machine reboot it relaunches on the next Claude Code session — no systemd/launchd/NSSM setup needed.

### Supported providers

| Provider | API endpoint | Auth | Env var | Default snapshot | Run |
|----------|--------------|------|---------|-------------------|-----|
| **GLM / BigModel** (Zhipu) | `GET open.bigmodel.cn/api/monitor/usage/quota/limit` | `Authorization: <key>` (no Bearer) | `GLM_API_KEY` | `~/.claude/glm-usage-snapshot.json` | `npm run glm:poll` |
| **MiniMax** | `GET api.minimaxi.com/.../coding_plan/remains` (CN) or `api.minimax.io` (EN) | `Authorization: Bearer <key>` | `MINIMAX_API_KEY` | `~/.claude/minimax-usage-snapshot.json` | `npm run minimax:poll` |
| **Alibaba / Bailian** | `POST {gateway}/data/api.json` (intl + cn gateways, auto-fallback) | `Bearer` + `x-api-key` + `X-Dashscope-API-Key` | `ALIBABA_API_KEY` / `DASHSCOPE_API_KEY` | `~/.claude/alibaba-usage-snapshot.json` | `npm run alibaba:poll` |
| **Kimi / Moonshot** | `GET {baseURL}/coding/v1/usages` (default `api.kimi.com`) | `Authorization: Bearer <key>` | `KIMI_CODE_API_KEY` | `~/.claude/kimi-usage-snapshot.json` | `npm run kimi:poll` |

> Append `:once` (e.g. `npm run glm:poll:once`) for a single fetch to verify your key. Each poller has a `config.example.json` documenting `apiKey`, `intervalSec`, `snapshotPath`, and provider-specific options (GLM `weeklyLimitType`, MiniMax/Alibaba `region`, Kimi `baseURL`).

### Usage

1. **Provide an API key** — any one of: the env var, `config.json` `apiKey`, or auto-detected from `settings.json` (works automatically if `ANTHROPIC_BASE_URL` already points at the vendor).
2. **Install & restart** — after `/plugin install claude-hud`, the next Claude Code session auto-starts whichever pollers have a resolved key.
3. **Point the HUD at the snapshot** in `~/.claude/plugins/claude-hud/config.json`:

```json
{
  "display": {
    "externalUsagePath": "/absolute/path/to/glm-usage-snapshot.json",
    "sevenDayThreshold": 0,
    "timeFormat": "elapsed"
  }
}
```

- `sevenDayThreshold: 0` shows the weekly window unconditionally (default 80 hides it).
- `timeFormat: "elapsed"` renders the Usage bar as `25% (1h 30m / 5h)`.

Switching providers is just changing `externalUsagePath` to the matching snapshot.

---

## Requirements

- Claude Code v1.0.80+
- macOS/Linux: Node.js 18+ or Bun
- Windows: Node.js 18+

---

## Development

```bash
git clone https://github.com/tsungseu/claude-hud-advanced
cd claude-hud
npm ci && npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT — see [LICENSE](LICENSE)

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=tsungseu/claude-hud-advanced&type=Date)](https://star-history.com/#tsungseu/claude-hud-advanced&Date)
