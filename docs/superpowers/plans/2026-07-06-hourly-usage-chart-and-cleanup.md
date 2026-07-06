# Hourly Usage Chart + Dashboard Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-hour token usage bar chart (last 24h, workspace-wide, stacked input/output/cache) to the Claude HUD VS Code extension's click-through dashboard, switch the dashboard to push-based refresh, and remove the terminal-HUD view and its dependencies.

**Architecture:** New `readHourlyUsage` collects per-hour token buckets across all transcripts in the workspace's project dir (last 24h). A new pure `chart-html.ts` renders those buckets as a stacked CSS bar-chart HTML string. The dashboard webview switches from reassigning `webview.html` on each refresh to seeding once + receiving snapshots via `postMessage` and DOM-updating. The terminal-HUD view, its subprocess spawn, ANSI conversion, and `hudEntryPath` config are deleted.

**Tech Stack:** TypeScript, esbuild (build), `node:test` (test runner, zero new deps), VSCode Extension API 1.85+.

**Spec:** `docs/superpowers/specs/2026-07-06-hourly-usage-chart-and-cleanup-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `vscode-extension/test/helpers.ts` | Create | Test helpers: write a temp transcript JSONL, make a temp project dir. |
| `vscode-extension/src/usage-data.ts` | Modify | Add `HourlyBucket`, `readHourlyUsage`, `hourlyBuckets` on `HudSnapshot`, wire into `collectHudSnapshot`. |
| `vscode-extension/src/chart-html.ts` | Create | Pure `renderHourlyChartHtml(buckets)` + palette constants. No vscode/IO. |
| `vscode-extension/src/detail-webview.ts` | Modify | Add chart block; switch to postMessage push; remove terminal-HUD view + its imports. |
| `vscode-extension/src/status-bar.ts` | Modify | Tooltip footer wording + add "最近 24h 用量见详情面板" line. |
| `vscode-extension/src/config.ts` | Modify | Remove `hudEntryPath` field. |
| `vscode-extension/package.json` | Modify | Remove `claudeHud.hudEntryPath` config; add `test` script. |
| `vscode-extension/src/hud-subprocess.ts` | Delete | Only served terminal HUD. |
| `vscode-extension/src/ansi-to-html.ts` | Delete | Only served terminal HUD. |
| `vscode-extension/README.md` | Modify | Drop terminal-HUD + claude-hud-install mentions. |

All paths below are relative to `vscode-extension/`.

---

### Task 1: Test infrastructure

**Files:**
- Modify: `package.json` (add test script + node-test types)
- Create: `test/helpers.ts`
- Create: `test/smoke.test.ts`

- [ ] **Step 1: Add test runner script + types**

Modify `package.json` scripts to add:
```json
    "test": "esbuild test/*.test.ts --bundle --format=cjs --platform=node --outfile=out/test.js --log-level=warning && node --test out/test.js"
```
Add to `devDependencies` (already have `@types/node`; ensure present). Create `test/` directory.

- [ ] **Step 2: Create test helpers**

Create `test/helpers.ts`:
```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Write a transcript JSONL from an array of entry objects, return its path. */
export function writeTranscript(entries: object[]): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-test-'));
  const file = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return file;
}

/** Make an assistant entry with usage + timestamp. */
export function assistantEntry(opts: {
  timestamp: string;
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
}): object {
  return {
    type: 'assistant',
    timestamp: opts.timestamp,
    message: {
      usage: {
        input_tokens: opts.input ?? 0,
        output_tokens: opts.output ?? 0,
        cache_creation_input_tokens: opts.cacheCreation ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
      },
    },
  };
}
```

- [ ] **Step 3: Create a smoke test that proves the runner works**

Create `test/smoke.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 4: Run the test**

Run: `cd vscode-extension && npm test`
Expected: `✔ test runner works` and exit code 0.

- [ ] **Step 5: Commit**

```bash
cd ..   # repo root
git add vscode-extension/package.json vscode-extension/test/
git commit -m "test(vscode-ext): add node:test runner + helpers"
```

---

### Task 2: `readHourlyUsage` data function (TDD)

**Files:**
- Create: `test/usage-data.test.ts`
- Modify: `src/usage-data.ts`

- [ ] **Step 1: Write the failing test**

Create `test/usage-data.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readHourlyUsage } from '../src/usage-data';

test('readHourlyUsage buckets assistant turns by hour across files, deduping consecutive dupes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  // Two sessions; the second has a consecutive duplicate usage block.
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:10:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:30:00.000Z', message: { usage: { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T14:05:00.000Z', message: { usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'b.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:50:00.000Z', message: { usage: { input_tokens: 300, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    // consecutive duplicate of the previous usage — must be skipped.
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:51:00.000Z', message: { usage: { input_tokens: 300, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');

  // now = 2026-07-06T15:00:00Z, so 24h window starts at 2026-07-05T15:00:00Z; all turns are within.
  const now = Date.parse('2026-07-06T15:00:00.000Z');
  const buckets = readHourlyUsage(dir, now);

  assert.equal(buckets.length, 2);
  const h13 = buckets[0];
  assert.equal(h13.hour, '2026-07-06T13:00:00.000Z');
  assert.equal(h13.inputTokens, 600);     // 100 + 200 + 300
  assert.equal(h13.outputTokens, 60);     // 10 + 20 + 30
  assert.equal(h13.cacheTokens, 55);      // (5+0) + (0+50) + (0+0)
  const h14 = buckets[1];
  assert.equal(h14.hour, '2026-07-06T14:00:00.000Z');
  assert.equal(h14.inputTokens, 50);
});

test('readHourlyUsage drops turns older than 24h', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-04T13:00:00.000Z', message: { usage: { input_tokens: 999, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-06T13:00:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n') + '\n');
  const now = Date.parse('2026-07-06T15:00:00.000Z');
  const buckets = readHourlyUsage(dir, now);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].inputTokens, 100);
});

test('readHourlyUsage returns empty array when dir missing', () => {
  const buckets = readHourlyUsage('/nonexistent/dir/xyz', Date.parse('2026-07-06T15:00:00.000Z'));
  assert.deepEqual(buckets, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test`
Expected: FAIL — `readHourlyUsage is not a function` (not yet exported).

- [ ] **Step 3: Implement `HourlyBucket` + `readHourlyUsage`**

In `src/usage-data.ts`, add near the other types (after `SessionTokens`):
```typescript
/** One hour's accumulated token usage, for the per-hour usage chart. */
export interface HourlyBucket {
  /** Hour key, ISO truncated to the hour: YYYY-MM-DDTHH:00:00.000Z */
  hour: string;
  inputTokens: number;
  outputTokens: number;
  /** cache_creation + cache_read combined into one layer. */
  cacheTokens: number;
}
```

Add the function (after `readSessionTokenTotals`):
```typescript
/**
 * Read ALL transcripts under a project dir and bucket assistant-turn token
 * usage by hour, keeping only the last 24h. Consecutive duplicate usage
 * blocks are skipped (same dedup as readSessionTokenTotals). Returns buckets
 * sorted ascending by hour; empty array if the dir is missing/empty.
 *
 * `projectDir` is the encoded ~/.claude/projects/<encoded-cwd> path.
 */
export function readHourlyUsage(projectDir: string, now: number): HourlyBucket[] {
  let files: string[];
  try {
    files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const windowStart = now - 24 * 60 * 60 * 1000;
  const buckets = new Map<string, HourlyBucket>();

  for (const name of files) {
    const full = path.join(projectDir, name);
    let raw: string;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    let lastKey: string | undefined;
    for (const line of raw.split(/\r?\n/)) {
      if (!line || !line.trim()) { lastKey = undefined; continue; }
      let entry: { type?: string; timestamp?: string; message?: { usage?: Record<string, unknown> } };
      try {
        entry = JSON.parse(line);
      } catch {
        lastKey = undefined;
        continue;
      }
      if (entry.type !== 'assistant' || !entry.timestamp) { lastKey = undefined; continue; }
      const usage = entry.message?.usage;
      if (!usage) { lastKey = undefined; continue; }

      const ts = Date.parse(entry.timestamp);
      if (!Number.isFinite(ts) || ts < windowStart) {
        lastKey = undefined;
        continue;
      }

      const inT = normalizeToken(usage.input_tokens);
      const outT = normalizeToken(usage.output_tokens);
      const ccT = normalizeToken(usage.cache_creation_input_tokens);
      const crT = normalizeToken(usage.cache_read_input_tokens);
      const key = `${inT}|${outT}|${ccT}|${crT}`;
      if (key === lastKey) continue;
      lastKey = key;

      // Truncate to the hour: YYYY-MM-DDTHH:00:00.000Z
      const d = new Date(ts);
      d.setUTCMinutes(0, 0, 0);
      const hour = d.toISOString();

      let b = buckets.get(hour);
      if (!b) {
        b = { hour, inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
        buckets.set(hour, b);
      }
      b.inputTokens += inT;
      b.outputTokens += outT;
      b.cacheTokens += ccT + crT;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ..
git add vscode-extension/test/usage-data.test.ts vscode-extension/src/usage-data.ts
git commit -m "feat(vscode-ext): readHourlyUsage — 24h per-hour token buckets"
```

---

### Task 3: Wire `hourlyBuckets` into `HudSnapshot`

**Files:**
- Modify: `src/usage-data.ts`
- Modify: `src/transcript-resolver.ts` (export encoded project dir helper if needed — check)

- [ ] **Step 1: Add `hourlyBuckets` to `HudSnapshot`**

In `src/usage-data.ts`, add to the `HudSnapshot` interface (after `snapshotStatus`):
```typescript
  /** Per-hour token usage over the last 24h, for the chart. */
  hourlyBuckets: HourlyBucket[];
```

- [ ] **Step 2: Compute it in `collectHudSnapshot`**

The function needs the **encoded project dir**, not just a transcript path. `readHourlyUsage` takes the project dir path. In `collectHudSnapshot`, the `workspaceFolder` is available; the encoded project dir is `path.join(getProjectsDir(), encodeProjectDir(workspaceFolder))`. `getProjectsDir` is in `claude-config-dir.ts` (already imported indirectly); `encodeProjectDir` is exported from `transcript-resolver.ts`.

In `src/usage-data.ts`, add imports at top:
```typescript
import { getProjectsDir } from './claude-config-dir';
import { encodeProjectDir } from './transcript-resolver';
```

In `collectHudSnapshot`, after `snapshotStatus` is computed, add:
```typescript
  const hourlyBuckets = workspaceFolder
    ? readHourlyUsage(path.join(getProjectsDir(), encodeProjectDir(workspaceFolder)), Date.now())
    : [];
```
And in the returned object, add `hourlyBuckets,` (after `snapshotStatus,`).

- [ ] **Step 3: Run typecheck + tests**

Run: `cd vscode-extension && npx tsc --noEmit && npm test`
Expected: no type errors; tests still pass.

- [ ] **Step 4: Commit**

```bash
cd ..
git add vscode-extension/src/usage-data.ts
git commit -m "feat(vscode-ext): hourlyBuckets on HudSnapshot"
```

---

### Task 4: `renderHourlyChartHtml` pure function (TDD)

**Files:**
- Create: `test/chart-html.test.ts`
- Create: `src/chart-html.ts`

- [ ] **Step 1: Write the failing test**

Create `test/chart-html.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHourlyChartHtml } from '../src/chart-html';
import type { HourlyBucket } from '../src/usage-data';

test('renderHourlyChartHtml returns placeholder for empty buckets', () => {
  const html = renderHourlyChartHtml([]);
  assert.match(html, /最近 24h 无用量数据/);
  assert.doesNotMatch(html, /chart-col/);
});

test('renderHourlyChartHtml renders one column per bucket with stacked segments', () => {
  const buckets: HourlyBucket[] = [
    { hour: '2026-07-06T13:00:00.000Z', inputTokens: 100, outputTokens: 50, cacheTokens: 200 },
    { hour: '2026-07-06T14:00:00.000Z', inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
    { hour: '2026-07-06T15:00:00.000Z', inputTokens: 300, outputTokens: 0, cacheTokens: 0 },
  ];
  const html = renderHourlyChartHtml(buckets);
  // Two non-zero columns rendered (the all-zero bucket is skipped).
  const colCount = (html.match(/chart-col/g) || []).length;
  assert.equal(colCount, 2);
  // Hour labels present.
  assert.match(html, /13/);
  assert.match(html, /15/);
  // Stacked segment classes present.
  assert.match(html, /seg-input/);
  assert.match(html, /seg-output/);
  assert.match(html, /seg-cache/);
});

test('renderHourlyChartHtml scales column height by the max-total bucket', () => {
  const buckets: HourlyBucket[] = [
    { hour: '2026-07-06T13:00:00.000Z', inputTokens: 100, outputTokens: 0, cacheTokens: 0 },
    { hour: '2026-07-06T14:00:00.000Z', inputTokens: 400, outputTokens: 0, cacheTokens: 0 },
  ];
  const html = renderHourlyChartHtml(buckets);
  // The taller column (400) should have a larger inline height than the 100 one.
  const heights = [...html.matchAll(/height:\s*([0-9.]+)%/g)].map((m) => parseFloat(m[1]));
  assert.ok(heights.length >= 2);
  assert.ok(Math.max(...heights) > Math.min(...heights));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test`
Expected: FAIL — cannot find module `../src/chart-html`.

- [ ] **Step 3: Implement `chart-html.ts`**

Create `src/chart-html.ts`:
```typescript
// Pure HTML generator for the per-hour usage chart. No vscode API, no IO —
// consumes HourlyBucket[] and returns an HTML string. Unit-testable.
import type { HourlyBucket } from './usage-data';

const COLORS = {
  input: '#00bfff',
  output: '#ff6347',
  cache: '#9b8bcf',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Render the per-hour usage chart as an HTML string. Each non-zero bucket is a
 * stacked column (input / output / cache); the busiest hour is full height and
 * others scale relative to it. Returns a placeholder message when buckets is
 * empty.
 */
export function renderHourlyChartHtml(buckets: HourlyBucket[]): string {
  const nonZero = buckets.filter((b) => b.inputTokens + b.outputTokens + b.cacheTokens > 0);
  if (nonZero.length === 0) {
    return `<div class="chart-empty">最近 24h 无用量数据</div>`;
  }

  const maxTotal = Math.max(...nonZero.map((b) => b.inputTokens + b.outputTokens + b.cacheTokens), 1);

  const cols = nonZero.map((b) => {
    const total = b.inputTokens + b.outputTokens + b.cacheTokens;
    const colHeightPct = (total / maxTotal) * 100;
    const hourLabel = b.hour.slice(11, 13); // "HH" from the ISO hour key
    const segments = [
      b.inputTokens > 0 ? `<div class="seg seg-input" style="flex:${b.inputTokens};background:${COLORS.input}"></div>` : '',
      b.outputTokens > 0 ? `<div class="seg seg-output" style="flex:${b.outputTokens};background:${COLORS.output}"></div>` : '',
      b.cacheTokens > 0 ? `<div class="seg seg-cache" style="flex:${b.cacheTokens};background:${COLORS.cache}"></div>` : '',
    ].join('');
    const tip = `${escapeHtml(b.hour.slice(0, 16).replace('T', ' '))} · in ${formatK(b.inputTokens)} · out ${formatK(b.outputTokens)} · cache ${formatK(b.cacheTokens)}`;
    return `<div class="chart-col" style="height:${colHeightPct.toFixed(1)}%" data-tip="${escapeHtml(tip)}">${segments}</div>`;
  }).join('');

  const legend = `<div class="chart-legend"><span class="dot seg-input"></span> input <span class="dot seg-output"></span> output <span class="dot seg-cache"></span> cache</div>`;

  return `<div class="chart">${cols}</div><div class="chart-axis">${nonZero.map((b) => `<span>${b.hour.slice(11, 13)}</span>`).join('')}</div>${legend}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test`
Expected: PASS (all tests including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
cd ..
git add vscode-extension/test/chart-html.test.ts vscode-extension/src/chart-html.ts
git commit -m "feat(vscode-ext): renderHourlyChartHtml — stacked CSS bar chart"
```

---

### Task 5: Dashboard push-refresh + chart block + remove terminal HUD

**Files:**
- Modify: `src/detail-webview.ts`
- Delete: `src/hud-subprocess.ts`
- Delete: `src/ansi-to-html.ts`

This is the largest task. It does three things in the webview: (a) add the chart block, (b) switch to postMessage push, (c) delete the terminal-HUD view.

- [ ] **Step 1: Add chart CSS to the dashboard stylesheet**

In `src/detail-webview.ts`, find the `DASHBOARD_CSS` const and append chart styles before the closing backtick:
```css
  .chart-block h3 { margin-bottom: 8px; }
  .chart {
    display: flex; align-items: flex-end; gap: 4px;
    height: 120px; padding: 8px 0; border-bottom: 1px solid #2a2a30;
  }
  .chart-col {
    flex: 1; display: flex; flex-direction: column-reverse;
    min-width: 10px; border-radius: 3px 3px 0 0; overflow: hidden;
    position: relative;
  }
  .chart-col .seg { min-height: 1px; }
  .chart-col:hover { filter: brightness(1.2); }
  .chart-col:hover::after {
    content: attr(data-tip); position: absolute; bottom: 100%; left: 50%;
    transform: translateX(-50%); white-space: nowrap;
    background: #000; color: #fff; padding: 4px 8px; border-radius: 4px;
    font-size: 10px; pointer-events: none; z-index: 10;
  }
  .chart-axis { display: flex; gap: 4px; padding-top: 4px; }
  .chart-axis span { flex: 1; text-align: center; font-size: 10px; color: #7a7a82; min-width: 10px; }
  .chart-empty { color: #7a7a82; font-size: 12px; padding: 16px 0; text-align: center; }
  .chart-legend { font-size: 10px; color: #8a8a92; padding-top: 6px; display: flex; gap: 10px; align-items: center; }
  .chart-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 3px; vertical-align: middle; }
  .chart-legend .seg-input { background: #00bfff; }
  .chart-legend .seg-output { background: #ff6347; }
  .chart-legend .seg-cache { background: #9b8bcf; }
```

- [ ] **Step 2: Add the chart block to the dashboard HTML**

In `detail-webview.ts`, add the import at top:
```typescript
import { renderHourlyChartHtml } from './chart-html';
```
In `dashboardHtml(s)`, after the `contextBlock(s)` line and before the footer, add:
```typescript
  ${chartBlock(s)}
```
And add the `chartBlock` function near the other block helpers (`resetBlock`/`spendBlock`/`contextBlock`):
```typescript
function chartBlock(s: HudSnapshot): string {
  return `  <section class="block chart-block">
    <h3>分时段用量 (最近 24h)</h3>
    ${renderHourlyChartHtml(s.hourlyBuckets)}
  </section>`;
}
```
Remove the `<footer class="card-footer">…查看终端 HUD…</footer>` block and its `<script>` (the terminal-switch message handler) from `dashboardHtml`.

- [ ] **Step 3: Switch refresh to postMessage push**

In `detail-webview.ts`:
- Remove the `View` type, `currentView` field, `renderTerminalView` method, `terminalShellHtml` method.
- Change `onSnapshot` to push instead of re-rendering:
```typescript
  onSnapshot(snapshot: HudSnapshot | null): void {
    this.currentSnapshot = snapshot;
    if (this.panel && this.panel.visible && snapshot) {
      // Serialize: Date fields become ISO strings; the webview JS handles that.
      this.panel.webview.postMessage(JSON.parse(JSON.stringify(snapshot)));
    }
  }
```
- In `showOrFocus`, remove the `this.currentView = 'dashboard';` line.
- In `registerDispose`, remove the `panel.webview.onDidReceiveMessage` view-switch block (keep `enableScripts: true` so the inline JS for postMessage works — add `enableScripts: true` to the panel options if not already present).

- [ ] **Step 4: Add webview inline JS to handle the initial paint + postMessage updates**

The initial HTML already inlines the first snapshot. Change `dashboardHtml` to also emit a `<script>` that:
- Renders the full card from the inlined snapshot on load.
- Listens for `message` events and re-renders.

Append to the `dashboardHtml` return, before `</body>`:
```html
<script>
  const initial = __SNAPSHOT_JSON__;
  function fmtTok(n){ if(!n&&n!==0)return '—'; if(n>=1e6)return (n/1e6).toFixed(1)+'M'; if(n>=1e3)return (n/1e3).toFixed(1)+'k'; return String(n); }
  function pct(n){ return (n===null||n===undefined)?'—':Math.round(n)+'%'; }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function renderChart(buckets){
    const el = document.getElementById('chart-area'); if(!el) return;
    const nz = (buckets||[]).filter(b=>b.inputTokens+b.outputTokens+b.cacheTokens>0);
    if(!nz.length){ el.innerHTML = '<div class="chart-empty">最近 24h 无用量数据</div>'; return; }
    const max = Math.max(...nz.map(b=>b.inputTokens+b.outputTokens+b.cacheTokens),1);
    el.innerHTML = '<div class="chart">'+nz.map(b=>{
      const tot=b.inputTokens+b.outputTokens+b.cacheTokens; const h=(tot/max*100).toFixed(1);
      const segs=[b.inputTokens>0?'<div class="seg seg-input" style="flex:'+b.inputTokens+';background:#00bfff"></div>':'',
                  b.outputTokens>0?'<div class="seg seg-output" style="flex:'+b.outputTokens+';background:#ff6347"></div>':'',
                  b.cacheTokens>0?'<div class="seg seg-cache" style="flex:'+b.cacheTokens+';background:#9b8bcf"></div>':''].join('');
      const tip=esc(b.hour.slice(0,16).replace('T',' '))+' · in '+fmtTok(b.inputTokens)+' · out '+fmtTok(b.outputTokens)+' · cache '+fmtTok(b.cacheTokens);
      return '<div class="chart-col" style="height:'+h+'%" data-tip="'+tip+'">'+segs+'</div>';
    }).join('')+'</div><div class="chart-axis">'+nz.map(b=>'<span>'+b.hour.slice(11,13)+'</span>').join('')+'</div>';
  }
  function setText(id, v){ const el=document.getElementById(id); if(el) el.textContent = v; }
  function renderAll(s){
    renderChart(s.hourlyBuckets);
    const u = s.usage;
    setText('cost', s.sessionCostYuan!==null ? '≈¥'+s.sessionCostYuan.toFixed(2) : '—');
    if(s.sessionTokens){
      setText('breakdown', fmtTok(s.sessionTokens.inputTokens)+' in · '+fmtTok(s.sessionTokens.outputTokens)+' out · '+fmtTok(s.sessionTokens.cacheCreationTokens)+' cache');
    }
    if(s.contextPercent!==null){
      setText('ctx-pct', pct(s.contextPercent));
      const used = s.contextTokens ? (s.contextTokens.inputTokens+s.contextTokens.cacheCreationTokens+s.contextTokens.cacheReadTokens) : 0;
      setText('ctx-tok', fmtTok(used)+' / '+fmtTok(s.windowSize));
    }
    if(u){
      if(u.fiveHourPercent!==null) setText('w5-pct', pct(u.fiveHourPercent)); 
    }
  }
  renderAll(initial);
  window.addEventListener('message', e => { if(e.data) renderAll(e.data); });
</script>
```

Then add `id` attributes to the cells the JS targets. Update the block helpers:
- In `spendBlock`: wrap the cost value as `<span class="value" id="cost">…</span>` and the breakdown as `<span id="breakdown">…</span>`.
- In `contextBlock`: wrap the percent as `<span class="window-pct" id="ctx-pct">…</span>` and the token line as `<span class="window-reset" id="ctx-tok">…</span>`.

And in the `chartBlock` HTML, wrap the chart output in `<div id="chart-area">…</div>` so JS can target it:
```typescript
function chartBlock(s: HudSnapshot): string {
  return `  <section class="block chart-block">
    <h3>分时段用量 (最近 24h)</h3>
    <div id="chart-area">${renderHourlyChartHtml(s.hourlyBuckets)}</div>
  </section>`;
}
```
Inject the snapshot JSON by string-replacing `__SNAPSHOT_JSON__` at the end of `dashboardHtml`: build the whole HTML string, then `return html.replace('__SNAPSHOT_JSON__', JSON.stringify(s));`.

- [ ] **Step 5: Remove unused imports + delete terminal-HUD files**

In `detail-webview.ts`, remove these imports (no longer used):
```typescript
import { renderHudOnce, resolveHudEntry } from './hud-subprocess';
import { ansiToHtml } from './ansi-to-html';
import { readSettings } from './config';
```
Delete the files:
```bash
cd vscode-extension
git rm src/hud-subprocess.ts src/ansi-to-html.ts
```

- [ ] **Step 6: Typecheck + build**

Run: `cd vscode-extension && npx tsc --noEmit && node esbuild.config.mjs --production`
Expected: no type errors; bundle built.

- [ ] **Step 7: Commit**

```bash
cd ..
git add vscode-extension/src/detail-webview.ts
git rm vscode-extension/src/hud-subprocess.ts vscode-extension/src/ansi-to-html.ts
git commit -m "feat(vscode-ext): chart block + postMessage push; remove terminal HUD"
```

---

### Task 6: Remove `hudEntryPath` config

**Files:**
- Modify: `src/config.ts`
- Modify: `package.json`

- [ ] **Step 1: Remove from `HudSettings` + `readSettings`**

In `src/config.ts`, delete the `hudEntryPath: string;` line from `HudSettings`, and delete the `hudEntryPath: c.get<string>('hudEntryPath', ''),` line from `readSettings`.

- [ ] **Step 2: Remove from `package.json`**

In `package.json`, delete the entire `claudeHud.hudEntryPath` configuration property block.

- [ ] **Step 3: Typecheck**

Run: `cd vscode-extension && npx tsc --noEmit`
Expected: no errors. (If `status-bar.ts` or elsewhere referenced `settings.hudEntryPath`, it was only via detail-webview which is now cleaned — verify no stray references.)

- [ ] **Step 4: Commit**

```bash
cd ..
git add vscode-extension/src/config.ts vscode-extension/package.json
git commit -m "chore(vscode-ext): remove hudEntryPath config (terminal HUD gone)"
```

---

### Task 7: Tooltip wording + README cleanup

**Files:**
- Modify: `src/status-bar.ts`
- Modify: `README.md`

- [ ] **Step 1: Update tooltip footer wording**

In `src/status-bar.ts`, in `buildTooltip`, change the final lines:
```typescript
    md.appendMarkdown(`---\n\n$(info) 点击查看完整 HUD`);
```
to:
```typescript
    md.appendMarkdown(`最近 24h 用量见详情面板  \n\n---\n\n$(info) 点击查看用量仪表盘`);
```

- [ ] **Step 2: Clean README**

In `README.md`:
- Remove the requirement line: `- For the **full HUD panel**, install the [claude-hud](...) plugin (...). The status bar summary works without it.`
- Update the "Click for the full HUD" bullet to describe the dashboard card + chart instead of the terminal HUD. Replace that bullet with:
```
- **Click for the dashboard:** opens a styled usage card — plan reset windows, credits & spend, context usage, and a per-hour token usage chart (last 24h). Updated live via push.
```
- Remove the `claudeHud.hudEntryPath` row from the configuration table.

- [ ] **Step 3: Commit**

```bash
cd ..
git add vscode-extension/src/status-bar.ts vscode-extension/README.md
git commit -m "docs(vscode-ext): tooltip wording + README (dashboard + chart, no terminal HUD)"
```

---

### Task 8: Verify end-to-end + package

- [ ] **Step 1: Run full test suite + typecheck + build**

Run:
```bash
cd vscode-extension
npm test
npx tsc --noEmit
node esbuild.config.mjs --production
```
Expected: all tests pass; no type errors; bundle built.

- [ ] **Step 2: Bump version + package + install**

In `package.json`, bump `"version": "0.3.0"` → `"0.4.0"`. Then:
```bash
npx vsce package --no-dependencies --allow-missing-repository
code --install-extension claude-hud-vscode-0.4.0.vsix --force
```

- [ ] **Step 3: Manual verification (developer reloads window)**

`Developer: Reload Window`, then:
- Click the status bar → dashboard card opens with the chart block at the bottom.
- Hover a chart column → tooltip shows hour + token breakdown.
- Confirm no "查看终端 HUD" link remains.
- Run a Claude Code turn → chart updates live (new bucket appears) without the panel flickering.

- [ ] **Step 4: Commit + push**

```bash
cd ..
git add vscode-extension/package.json
git commit -m "chore(vscode-ext): v0.4.0 — hourly chart + dashboard cleanup"
git push
```
