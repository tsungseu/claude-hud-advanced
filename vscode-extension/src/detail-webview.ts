// The click-through dashboard panel: a styled usage card matching the reference
// design (dark card, cyan context bar, coral usage bar, status dot, 30-day
// daily token-usage chart). Built as a webview so we get full CSS color control
// (the hover tooltip's MarkdownString can't do custom colors). The HTML is
// seeded once on open with the current snapshot inlined; subsequent snapshots
// are pushed via postMessage and applied to the DOM by the inline script (no
// full re-render).
import * as vscode from 'vscode';
import {
  contextLevel,
  quotaLevel,
  renderCountdownShort,
  renderPercent,
  formatTokens,
  type Level,
} from './bar';
import type { HudSnapshot, ProviderUsage } from './usage-data';
import { renderDailyChartHtml } from './chart-html';

export class DetailPanelManager {
  private panel: vscode.WebviewPanel | null = null;
  private currentSnapshot: HudSnapshot | null = null;
  private rendering = false;

  showOrFocus(snapshot: HudSnapshot | null): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, false);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'claudeHudDetail',
        'Claude HUD',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: false },
      );
      panel.iconPath = new vscode.ThemeIcon('pulse');
      this.panel = panel;
      this.registerDispose(panel);
      panel.webview.html = this.shellHtml('Loading…');
    }
    this.currentSnapshot = snapshot;
    void this.render();
  }

  onSnapshot(snapshot: HudSnapshot | null): void {
    this.currentSnapshot = snapshot;
    if (this.panel && this.panel.visible && snapshot) {
      // Serialize: Date fields become ISO strings; the webview JS handles that.
      this.panel.webview.postMessage(JSON.parse(JSON.stringify(snapshot)));
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  private registerDispose(panel: vscode.WebviewPanel): void {
    panel.onDidDispose(() => {
      this.panel = null;
      this.currentSnapshot = null;
    });
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) {
        void this.render();
      }
    });
  }

  private async render(): Promise<void> {
    const panel = this.panel;
    if (!panel || this.rendering) return;
    this.rendering = true;
    try {
      const snapshot = this.currentSnapshot;
      if (!snapshot || !snapshot.transcriptPath) {
        panel.webview.html = this.messageHtml(
          'No active Claude Code transcript found for this workspace.\n\nOpen a Claude Code session in this folder, then refresh.',
        );
        return;
      }

      panel.webview.html = this.dashboardHtml(snapshot);
    } catch (err) {
      const p = this.panel;
      if (p) {
        p.webview.html = this.messageHtml(`Unexpected error:\n\n${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.rendering = false;
    }
  }

  // ── Dashboard card HTML (the primary view) ───────────────────────────────

  private dashboardHtml(s: HudSnapshot): string {
    const statusInfo = statusDescriptor(s);
    const u = s.usage;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude HUD</title>
<style>${DASHBOARD_CSS}</style>
</head>
<body>
<div class="card">
  <header class="card-header">
    <div class="brand">
      <span class="starburst">✲</span>
      <span class="model">${escapeHtml(s.modelLabel)}</span>
    </div>
    <span class="status" style="--status-color:${statusInfo.color}">${statusInfo.label}</span>
  </header>

  ${resetBlock(u)}
  ${spendBlock(s)}
  ${contextBlock(s)}
  ${chartBlock(s)}
</div>
<script>
  const initial = __SNAPSHOT_JSON__;
  function fmtTok(n){ if(n===null||n===undefined)return '—'; if(n>=1e6)return (n/1e6).toFixed(1)+'M'; if(n>=1e3)return (n/1e3).toFixed(1)+'k'; return String(n); }
  function pct(n){ return (n===null||n===undefined)?'—':Math.round(n)+'%'; }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function renderChart(buckets){
    const el = document.getElementById('chart-area'); if(!el) return;
    const all = buckets||[];
    if(!all.length){ el.innerHTML = '<div class="chart-empty">最近 30 天无用量数据</div>'; return; }
    const max = Math.max(...all.map(b=>b.tokens||0),1);
    // "nice" Y axis: round max up to 1/2/5×10^k, 4 ticks.
    const exp=Math.pow(10,Math.floor(Math.log10(max)));
    const frac=max/exp; let nf; if(frac<=1)nf=1; else if(frac<=2)nf=2; else if(frac<=5)nf=5; else nf=10;
    const scaledMax=nf*exp;
    const ticks=[0,1,2,3].map(i=>fmtTok(scaledMax*i/3));
    // sparse X labels: ~1 per 5 days, always the last.
    const n=all.length, target=Math.min(6,Math.max(2,Math.round(n/5))), labelIdx=new Set();
    if(n===1) labelIdx.add(0); else for(let i=0;i<target;i++) labelIdx.add(Math.round(i*(n-1)/(target-1)));
    const shortDate=day=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day); return m?(parseInt(m[2],10)+'/'+parseInt(m[3],10)):day; };
    const bars=all.map((b,i)=>{
      const h=((b.tokens||0)/scaledMax*100).toFixed(1);
      const tip=esc(b.day)+' · '+fmtTok(b.tokens||0)+' tokens';
      const edge=i===0?' data-edge="left"':(i===n-1?' data-edge="right"':'');
      return '<div class="chart-bar" style="height:'+h+'%" data-tip="'+tip+'"'+edge+'></div>';
    }).join('');
    const yAxisHtml=ticks.slice().reverse().map(t=>'<div class="chart-ytick"><span>'+esc(t)+'</span></div>').join('');
    const xAxisHtml=all.map((b,i)=>'<span>'+(labelIdx.has(i)?esc(shortDate(b.day)):'')+'</span>').join('');
    el.innerHTML='<div class="chart-wrap"><div class="chart-yaxis">'+yAxisHtml+'</div>'
      +'<div class="chart-plot"><div class="chart">'+bars+'</div>'
      +'<div class="chart-xaxis">'+xAxisHtml+'</div></div></div>';
  }
  function setText(id, v){ const el=document.getElementById(id); if(el) el.textContent = v; }
  function setWidth(id, v){ const el=document.getElementById(id); if(el) el.style.width = v+'%'; }
  function renderAll(snap){
    const u = snap.usage;
    renderChart(snap.dailyBuckets);
    if(snap.sessionCostYuan!==null){
      setText('cost', '≈¥'+snap.sessionCostYuan.toFixed(2));
    }
    if(snap.sessionTokens){
      setText('breakdown', fmtTok(snap.sessionTokens.inputTokens)+' in · '+fmtTok(snap.sessionTokens.outputTokens)+' out · '+fmtTok(snap.sessionTokens.cacheCreationTokens)+' cache');
    }
    if(snap.contextPercent!==null){
      setText('ctx-pct', pct(snap.contextPercent));
      setWidth('ctx-fill', Math.round(snap.contextPercent));
      const used = snap.contextTokens ? (snap.contextTokens.inputTokens+snap.contextTokens.cacheCreationTokens+snap.contextTokens.cacheReadTokens) : 0;
      setText('ctx-tok', fmtTok(used)+' / '+fmtTok(snap.windowSize));
    }
    if(u){
      const upd = (id, p, resetAt) => {
        setText(id+'-pct', p===null||p===undefined?'—':Math.round(p)+'%');
        setWidth(id+'-fill', p===null||p===undefined?0:Math.round(p));
        // reset countdown formatting matching renderCountdownShort
        let txt = '—';
        if(resetAt){
          const ms = Date.parse(resetAt) - Date.now();
          if(ms<=0) txt='soon';
          else { const m=Math.round(ms/60000); if(m<1)txt='<1m'; else if(m<60)txt=m+'m'; else { const h=Math.floor(m/60),mm=m%60; if(h<48)txt=mm>0?h+'h '+mm+'m':h+'h'; else { const d=Math.floor(h/24),rh=h%24; txt=rh>0?d+'d '+rh+'h':d+'d'; } } }
          setText(id+'-reset', '重置 '+txt);
        }
      };
      upd('w5', u.fiveHourPercent, u.fiveHourResetAt);
      upd('w7', u.sevenDayPercent, u.sevenDayResetAt);
      upd('wm', null, null);
    }
  }
  renderAll(initial);
  window.addEventListener('message', e => { if(e.data) renderAll(e.data); });
</script>
</body>
</html>`;
    return html.replace('__SNAPSHOT_JSON__', JSON.stringify(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'));
  }

  private shellHtml(message: string): string {
    return this.messageHtml(message);
  }

  private messageHtml(message: string): string {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>${DASHBOARD_CSS}</style></head>
<body><div class="card"><div class="msg">${escapeHtml(message)}</div></div></body></html>`;
  }
}

// ── Dashboard sub-blocks ────────────────────────────────────────────────────

function resetBlock(u: ProviderUsage | null): string {
  const rows = [
    windowRow('5小时', u?.fiveHourPercent ?? null, u?.fiveHourResetAt ?? null, 'coral', 'w5'),
    windowRow('每周', u?.sevenDayPercent ?? null, u?.sevenDayResetAt ?? null, 'coral', 'w7'),
    windowRow('每月', null, null, 'coral', 'wm'),
  ];
  return `  <section class="block">
    <h3>计划重置</h3>
    <div class="windows">${rows.join('')}</div>
  </section>`;
}

function windowRow(label: string, percent: number | null, resetAt: Date | null, accent: string, id: string): string {
  const pct = percent ?? 0;
  const level = quotaLevel(percent);
  const countdown = renderCountdownShort(resetAt);
  const showData = percent !== null;
  return `    <div class="window">
      <div class="window-head">
        <span class="window-label">${levelDot(level)} ${escapeHtml(label)}</span>
        <span class="window-pct" id="${id}-pct">${showData ? renderPercent(percent) : '—'}</span>
      </div>
      <div class="bar-track"><div class="bar-fill ${accent}" id="${id}-fill" style="width:${showData ? pct : 0}%"></div></div>
      <div class="window-reset" id="${id}-reset">${showData ? `重置 ${escapeHtml(countdown)}` : '不可用'}</div>
    </div>`;
}

function spendBlock(s: HudSnapshot): string {
  const cost = s.sessionCostYuan !== null ? `≈¥${s.sessionCostYuan.toFixed(2)}` : '—';
  const tok = s.sessionTokens;
  const breakdown = tok
    ? `${formatTokens(tok.inputTokens)} in · ${formatTokens(tok.outputTokens)} out · ${formatTokens(tok.cacheCreationTokens)} cache`
    : '—';
  return `  <section class="block">
    <h3>积分与支出</h3>
    <div class="kv"><span>会话成本</span><span class="value" id="cost">${cost}</span></div>
    <div class="kv muted"><span>Token 明细</span><span id="breakdown">${breakdown}</span></div>
    <div class="kv muted"><span>余额</span><span>—</span></div>
    <div class="kv muted"><span>月支出</span><span>—</span></div>
  </section>`;
}

function contextBlock(s: HudSnapshot): string {
  const pct = s.contextPercent ?? 0;
  const show = s.contextPercent !== null;
  const level = contextLevel(s.contextPercent);
  const used = s.contextTokens
    ? formatTokens(s.contextTokens.inputTokens + s.contextTokens.cacheCreationTokens + s.contextTokens.cacheReadTokens)
    : '—';
  return `  <section class="block">
    <h3>上下文</h3>
    <div class="window">
      <div class="window-head">
        <span class="window-label">${levelDot(level)} 用量</span>
        <span class="window-pct" id="ctx-pct">${show ? renderPercent(s.contextPercent) : '—'}</span>
      </div>
      <div class="bar-track"><div class="bar-fill cyan" id="ctx-fill" style="width:${show ? pct : 0}%"></div></div>
      <div class="window-reset" id="ctx-tok">${used} / ${formatTokens(s.windowSize)}</div>
    </div>
  </section>`;
}

function chartBlock(s: HudSnapshot): string {
  return `  <section class="block chart-block">
    <h3>每日用量 (最近 30 天)</h3>
    <div id="chart-area">${renderDailyChartHtml(s.dailyBuckets)}</div>
  </section>`;
}

function levelDot(level: Level): string {
  const color = level === 'critical' ? '#ff5c5c' : level === 'warn' ? '#f0ad4e' : '#4ec9b0';
  return `<span class="dot" style="background:${color}"></span>`;
}

function statusDescriptor(s: HudSnapshot): { label: string; color: string } {
  if (s.snapshotStatus === 'stale') return { label: '快照过期', color: '#f0ad4e' };
  if (s.snapshotStatus === 'missing') return { label: '无快照', color: '#888' };
  const u = s.usage;
  const five = u?.fiveHourPercent ?? null;
  const seven = u?.sevenDayPercent ?? null;
  if ((five ?? 0) >= 90 || (seven ?? 0) >= 90) return { label: '已达上限', color: '#ff5c5c' };
  if ((five ?? 0) >= 75 || (seven ?? 0) >= 75) return { label: '接近上限', color: '#f0ad4e' };
  return { label: '正常', color: '#4ec9b0' };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Dashboard CSS — palette matched to the reference design ─────────────────
// Card: deep neutral; bars: cyan (context) + coral (usage); muted secondary text.
const DASHBOARD_CSS = `
  :root { color-scheme: dark; }
  html, body {
    margin: 0; padding: 0; min-height: 100%;
    background: var(--vscode-editor-background, #121214);
    color: #e4e4e7;
    font-family: var(--vscode-font-family, -apple-system, "Segoe UI", sans-serif);
    font-size: 13px;
  }
  body { display: flex; justify-content: center; padding: 24px; box-sizing: border-box; }
  .card {
    width: 100%; max-width: 420px;
    background: #1a1a1e;
    border: 1px solid #2a2a30;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    overflow: hidden;
  }
  .card-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid #2a2a30;
  }
  .brand { display: flex; align-items: center; gap: 8px; }
  .starburst { color: #d97757; font-size: 16px; line-height: 1; }
  .model { font-weight: 600; font-size: 14px; color: #f0f0f2; }
  .status {
    font-size: 12px; font-weight: 500;
    color: var(--status-color, #4ec9b0);
    display: inline-flex; align-items: center; gap: 5px;
  }
  .status::before {
    content: ""; width: 7px; height: 7px; border-radius: 50%;
    background: var(--status-color, #4ec9b0);
  }
  .block { padding: 14px 16px; border-bottom: 1px solid #2a2a30; }
  .block:last-of-type { border-bottom: none; }
  .block h3 {
    margin: 0 0 10px 0; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; color: #8a8a92;
  }
  .windows { display: flex; flex-direction: column; gap: 12px; }
  .window { display: flex; flex-direction: column; gap: 4px; }
  .window-head { display: flex; justify-content: space-between; align-items: center; }
  .window-label { color: #c8c8cc; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
  .window-pct { color: #f0f0f2; font-weight: 600; font-variant-numeric: tabular-nums; font-size: 12px; }
  .bar-track {
    height: 6px; background: #2e2e34; border-radius: 3px; overflow: hidden; margin-top: 2px;
  }
  .bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
  .bar-fill.cyan { background: #00bfff; box-shadow: 0 0 8px rgba(0,191,255,0.4); }
  .bar-fill.coral { background: #ff6347; box-shadow: 0 0 8px rgba(255,99,71,0.4); }
  .window-reset { font-size: 11px; color: #7a7a82; margin-top: 1px; }
  .kv {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 0; font-size: 12px;
  }
  .kv .value { font-weight: 600; color: #f0f0f2; font-variant-numeric: tabular-nums; }
  .kv.muted, .kv.muted .value { color: #8a8a92; font-weight: 400; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }
  .msg { padding: 24px 16px; color: #8a8a92; white-space: pre-wrap; line-height: 1.6; font-size: 12px; }
  .chart-block h3 { margin-bottom: 8px; }
  /* The chart block needs extra side room so edge-bar hover tooltips aren't
     clipped by the card's overflow:hidden, and a taller bottom band for the
     X-axis date labels. */
  .chart-block { padding-bottom: 18px; }
  /* Chart layout: a Y-axis column on the left, plot area (gridlines + bars)
     on the right, X-axis labels under the plot. Wide and short to match the
     reference design. */
  .chart-wrap { display: flex; align-items: flex-start; gap: 8px; }
  .chart-yaxis {
    display: flex; flex-direction: column; justify-content: space-between;
    width: 48px; flex-shrink: 0; text-align: right;
    /* Pin the axis to the chart's own height (not the taller plot column that
       includes the X-axis band) so ticks line up with the gridlines and the
       top/bottom labels don't overflow into neighbouring rows. */
    align-self: flex-start; height: 100px;
  }
  .chart-ytick { height: 0; display: flex; align-items: center; justify-content: flex-end; }
  .chart-ytick span { font-size: 10px; color: #7a7a82; font-variant-numeric: tabular-nums; transform: translateY(-50%); white-space: nowrap; }
  .chart-plot { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
  /* 4 horizontal gridlines via repeating-linear-gradient at 0/33/66/100%. */
  .chart {
    display: flex; align-items: flex-end; gap: 0;
    height: 100px; padding: 0;
    border-bottom: 1px solid #3a3a40;
    background-image: repeating-linear-gradient(
      to top,
      transparent 0, transparent calc(100%/3 - 1px),
      #2e2e34 calc(100%/3 - 1px), #2e2e34 calc(100%/3),
      transparent calc(100%/3), transparent calc(200%/3 - 1px),
      #2e2e34 calc(200%/3 - 1px), #2e2e34 calc(200%/3),
      transparent calc(200%/3), transparent calc(300%/3 - 1px),
      #2e2e34 calc(300%/3 - 1px), #2e2e34 calc(300%/3)
    );
  }
  .chart-bar {
    flex: 1 1 0; min-width: 1px;
    background: #00bfff; position: relative; opacity: 0.92;
    transition: opacity 0.15s ease;
  }
  .chart-bar:hover { opacity: 1; }
  .chart-bar:hover::after {
    content: attr(data-tip); position: absolute; bottom: 100%; left: 50%;
    transform: translateX(-50%); white-space: nowrap;
    background: #000; color: #fff; padding: 4px 8px; border-radius: 4px;
    font-size: 10px; pointer-events: none; z-index: 10;
  }
  /* Edge bars: flip tooltip alignment so it stays inside the card instead of
     overflowing (the card has overflow:hidden for its rounded corners). */
  .chart-bar[data-edge="left"]:hover::after { left: 0; transform: none; }
  .chart-bar[data-edge="right"]:hover::after { left: auto; right: 0; transform: none; }
  .chart-xaxis { display: flex; gap: 0; padding-top: 5px; height: 20px; }
  .chart-xaxis span { flex: 1 1 0; text-align: center; font-size: 10px; color: #7a7a82; min-width: 0; white-space: nowrap; }
  .chart-empty { color: #7a7a82; font-size: 12px; padding: 16px 0; text-align: center; }
`;
