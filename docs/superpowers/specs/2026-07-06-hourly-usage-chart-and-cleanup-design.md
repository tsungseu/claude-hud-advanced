# Design: Hourly Usage Chart + Dashboard Cleanup

**Date:** 2026-07-06
**Scope:** `vscode-extension/` (the standalone Claude HUD for VS Code extension)
**Status:** Approved (brainstorm complete)

## Goal

Three changes to the Claude HUD VS Code extension's detail dashboard:

1. **Hover tooltip stays text-only; click shows the colored dashboard** (already the case — confirmed VSCode's `MarkdownString` tooltip cannot render custom colors or charts). No change to the hover mechanism; only minor wording alignment.
2. **Add a per-hour token usage bar chart** to the click-through dashboard — stacked bars (input / output / cache) over the last 24 hours, sourced from all transcripts in the current workspace.
3. **Remove the terminal-HUD view** and all of its dependencies (subprocess spawn, ANSI-to-HTML, the `claudeHud.hudEntryPath` config). The extension becomes fully self-contained — it no longer spawns any subprocess and no longer depends on whether claude-hud is installed.

## Confirmed decisions (from brainstorm)

| Question | Decision |
|---|---|
| Bar chart axes | **Per-hour token usage** — X = hour (last 24h), Y = tokens, stacked input/output/cache |
| Chart data range | **Current workspace, last 24h** across all transcripts in the project dir |
| Hover mechanism | Keep text MarkdownString tooltip (no colors); colored dashboard is click-only |
| Dashboard refresh | **Push model** — status bar posts snapshots to the open webview via `postMessage`; webview DOM-updates without resetting `html` (avoids flicker) |

## Data layer

### New type

```typescript
interface HourlyBucket {
  /** Hour key, ISO truncated to the hour: YYYY-MM-DDTHH:00:00.000Z */
  hour: string;
  inputTokens: number;
  outputTokens: number;
  /** cache_creation + cache_read combined into one layer */
  cacheTokens: number;
}
```

### New function: `readHourlyUsage(projectDir, now)`

Located in `usage-data.ts`.

- Scans **all** `.jsonl` files under `~/.claude/projects/<encoded-cwd>/` (not just the current session's).
- For each line where `type === "assistant"` AND `message.usage` exists AND `timestamp` exists:
  - Dedup consecutive duplicate usage blocks (same fingerprint logic as the existing `readSessionTokenTotals`).
  - **Filter:** only keep turns whose `timestamp >= now - 24h`.
  - Bucket by hour (timestamp truncated to hour), accumulating `input_tokens` / `output_tokens` / (`cache_creation_input_tokens` + `cache_read_input_tokens`).
- Returns `HourlyBucket[]` sorted ascending by hour. Empty array when no recent data.

### `HudSnapshot` change

Add `hourlyBuckets: HourlyBucket[]`. `collectHudSnapshot` calls `readHourlyUsage(encodedProjectDir, now)`, deriving the encoded project dir from the existing `workspaceFolder` (same encoding as `transcript-resolver`).

### Performance

First version reads all matching transcripts in full (workspace session count is typically bounded, low tens). A future optimization can skip files whose mtime is older than 24h or unchanged since last read; not in this scope.

## Dashboard layout

The click-through webview keeps the existing dark card palette (card `#1a1a1e`, cyan context bar `#00bfff`, coral usage bar `#ff6347`) and adds a new block at the bottom. The "查看终端 HUD" footer link is removed.

```
┌─ Claude HUD ──────────────────────────────────┐
│  ✲ GLM-5.2              ● 正常                │  header (starburst + status dot)
├───────────────────────────────────────────────┤
│  计划重置                                      │
│   5小时   ████████░░ 72%      重置 2h 21m      │
│   每周    ░░░░░░░░░░ —        不可用           │
│   每月    ░░░░░░░░░░ —        不可用           │  coral bars
├───────────────────────────────────────────────┤
│  积分与支出                                    │
│   会话成本    ≈¥0.42                           │
│   Token 明细  169k in · 10k out                │
│   余额 —   月支出 —                            │
├───────────────────────────────────────────────┤
│  上下文                                        │
│   用量   █░░░░░░░░░ 6%   63k / 1M             │  cyan bar
├───────────────────────────────────────────────┤
│  分时段用量 (最近 24h)          单位: tokens   │  ★ NEW
│   ▌                                            │
│   ▌  ▌                                        │
│   ▌  ▌  ▌                                     │
│  ────────────────────────────                 │
│   13  14  15  ...        (hour)               │
│   ▌ input  ▌ output  ▌ cache (stacked)        │
└───────────────────────────────────────────────┘
```

## Push refresh (Approach A)

- `StatusBarManager.refresh()` already computes `HudSnapshot` on each tick and fires it via `_onDidUpdate`. `DetailPanelManager` already subscribes to that event through `onDidUpdate` (wired in `extension.ts`).
- **The change:** `DetailPanelManager.onSnapshot(snapshot)` — which currently only re-runs `render()` (reassigning `webview.html`) — instead calls `this.panel.webview.postMessage(snapshot)` when the panel is visible. So the push originates from `DetailPanelManager`, riding the existing `onDidUpdate` subscription; `StatusBarManager` itself is unchanged (it doesn't need a reference to the panel).
- The webview's inline JS listens via `window.addEventListener('message', ...)`, updates the card's blocks and redraws the chart from the new `hourlyBuckets`.
- On initial open, the panel is seeded with a full HTML document (skeleton + inline JS + initial snapshot inlined). Subsequent updates come via `postMessage` and mutate the DOM — **`webview.html` is never reassigned** after the first paint, avoiding flicker and scroll reset.
- `onSnapshot` keeps its existing `if (panel && panel.visible)` guard so hidden panels aren't pushed to.

## Chart implementation

Pure HTML/CSS — **no chart library** (keep the extension lightweight, network-free).

- `chart-html.ts` exports a pure function `renderHourlyChartHtml(buckets: HourlyBucket[]): string` returning the chart's HTML plus the palette constants. No `vscode` import, no IO — unit-testable.
- Each bucket is one column. The column is a `display:flex; flex-direction:column-reverse` container holding up to three segments (`input` / `output` / `cache`), each a `<div>` whose height is its share of the column's total; colors: input cyan `#00bfff`, output coral `#ff6347`, cache purple-gray `#9b8bcf`.
- Column overall height = `bucketTotal / globalMaxTotal` (the busiest hour is full height; others scale).
- Per-column hover shows a CSS tooltip (hour + per-type token counts).
- `detail-webview.ts` calls `renderHourlyChartHtml` to produce the initial HTML, and the webview's JS rebuilds the chart node from the pushed `hourlyBuckets` array on each message.

## Hover tooltip (minor)

Stays a `MarkdownString` (GFM tables, codicons, `█░` bars). Only changes:
- Footer text "点击查看完整 HUD" → "点击查看用量仪表盘" (wording alignment; the colored dashboard is the click target, no longer the terminal HUD).
- Add one line under 上下文: "最近 24h 用量见详情面板" (since the tooltip itself cannot render the chart).
No structural change; same data fields as the dashboard card.

## Terminal-HUD removal

| Action | Target |
|---|---|
| Delete file | `src/hud-subprocess.ts` (resolveHudEntry / buildSyntheticStdin / renderHudOnce) |
| Delete file | `src/ansi-to-html.ts` (only served the terminal HUD) |
| Edit `src/detail-webview.ts` | Remove `View` type, `renderTerminalView`, `terminalShellHtml`, the `onDidReceiveMessage` view-switch branch, and the `renderHudOnce`/`ansiToHtml`/`resolveHudEntry` imports |
| Edit `src/config.ts` + `package.json` | Remove `claudeHud.hudEntryPath` (only served the terminal HUD); remove `hudEntryPath` from `HudSettings` |
| Edit `README.md` | Drop the "For the full HUD panel, install claude-hud" note and any "查看终端 HUD" mention |
| Leave alone | `commands/setup.md` (that's claude-hud plugin's own file, not the extension's) |

After removal the extension is fully self-contained: status bar summary, hover tooltip, and click dashboard all read the transcript + provider snapshot directly, spawn nothing, and do not depend on claude-hud being installed. Package size shrinks.

## Error handling & edge cases

| Case | Handling |
|---|---|
| No assistant turn in the last 24h | Chart block shows "最近 24h 无用量数据" placeholder; no empty axis drawn |
| Only one bucket (e.g. 17 turns all within one hour) | Draw the single column, label it; do not pad with empty buckets |
| A transcript line has corrupt JSON | Skip the line (existing behavior in read* functions); other buckets unaffected |
| Workspace has no projectDir | Chart empty; block shows "无会话"; rest of card follows existing idle branch |
| An hour has zero total but sits between two non-zero hours | Do not render that column (gap), keeping the time axis continuous |
| cache all zero for a bucket | That segment has height 0, is not rendered; stacking unaffected |
| Snapshot stale/missing | Status dot turns amber/grey; chart unaffected (chart data is from the transcript, independent of the snapshot) |
| Panel closed when a push arrives | `onSnapshot` guards on `panel.visible`; no push |

## Unit boundaries

| File | Responsibility | Dependencies |
|---|---|---|
| `usage-data.ts` | Data collection: `readHourlyUsage`, existing read*/compute* | fs, transcript-resolver, config |
| `bar.ts` | Pure formatting helpers (renderBar/formatTokens/level/etc.), no IO | none |
| `status-bar.ts` | Status bar + hover tooltip + periodic refresh orchestration + push to panel | usage-data, bar, detail-webview |
| `detail-webview.ts` | Dashboard webview: HTML skeleton + postMessage receive + DOM update | usage-data types, bar, chart-html |
| **NEW** `chart-html.ts` | Pure function `renderHourlyChartHtml(buckets)` → HTML string + palette constants | none (called by detail-webview) |

`chart-html.ts` is isolated: it only consumes `HourlyBucket[]` and returns an HTML string, no `vscode` API, no IO — unit-testable. `detail-webview.ts` assembles and is message-driven; clear separation.

## Out of scope (YAGNI)

- Chart time-range switcher (24h / 7d / all) — fixed at 24h for now.
- Per-token-type filtering (view input only, etc.) — three-color stacked shows all.
- Historical event timeline.
- mtime-based transcript read caching (first version reads in full; sufficient).
