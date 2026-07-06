// Data layer: gathers everything the status bar / detail panel needs in a single
// structured snapshot. Pure local reads (transcript JSONL + provider usage
// snapshot + ~/.claude/settings.json). No subprocess, no network.
//
// Context usage: the transcript records the API `message.usage` for every
// assistant turn (claude-hud src/transcript.ts:383-395 accumulates these). The
// LAST assistant turn's usage is the best proxy we have for the *current*
// context fill: input_tokens + cache_creation_input_tokens + cache_read_input_tokens
// ≈ tokens currently in the context window. Divided by the window size that
// yields a context-usage percentage. This is approximate (post-/compact first
// frames, parallel subagents) but matches what claude-hud falls back to when the
// native `used_percentage` is absent.
//
// Usage/quota: read directly from the provider snapshot file the poller daemons
// already write (claude-hud src/external-usage.ts, shape: ExternalUsageSnapshot).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getClaudeConfigDir, getClaudeSettingsPath, getProjectsDir } from './claude-config-dir';
import { encodeProjectDir } from './transcript-resolver';

/** Token breakdown of the last assistant turn, used to derive context fill. */
export interface ContextTokens {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** Full-session accumulated token totals, for cost estimation + the tooltip. */
export interface SessionTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** One hour's accumulated token usage, for the per-hour usage chart. */
export interface HourlyBucket {
  /** Hour key, ISO truncated to the hour: YYYY-MM-DDTHH:00:00.000Z */
  hour: string;
  inputTokens: number;
  outputTokens: number;
  /** cache_creation + cache_read combined into one layer. */
  cacheTokens: number;
}

export type SnapshotStatus = 'fresh' | 'stale' | 'missing';

export interface ProviderUsage {
  fiveHourPercent: number | null;
  sevenDayPercent: number | null;
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
  balanceLabel: string | null;
  /** Which provider the snapshot came from, for display. */
  provider: string;
  /** Snapshot file path actually read. */
  snapshotPath: string;
  /** ms since the snapshot's updated_at, or null if unparseable. */
  ageMs: number | null;
  /** Freshness state — drives the status badge in the tooltip. */
  status: SnapshotStatus;
}

export interface HudSnapshot {
  /** null when no transcript / no assistant turn with usage yet. */
  contextPercent: number | null;
  contextTokens: ContextTokens | null;
  windowSize: number;
  usage: ProviderUsage | null;
  modelLabel: string;
  transcriptPath: string | null;
  workspaceFolder: string;
  /** How the transcript was matched to the workspace (for diagnostics). */
  transcriptMatchStrategy: import('./transcript-resolver').ResolvedTranscript['matchStrategy'] | 'none';
  /** Full-session accumulated tokens, for the cost-scan block. */
  sessionTokens: SessionTokens | null;
  /** Estimated session cost in yuan, or null when pricing unknown. */
  sessionCostYuan: number | null;
  /** Model id used to look up pricing (e.g. "glm-5.2[1m]"). */
  modelId: string;
  /** Overall provider freshness state for the status badge. */
  snapshotStatus: SnapshotStatus;
  /** Per-hour token usage over the last 24h, for the chart. */
  hourlyBuckets: HourlyBucket[];
  /** ISO timestamp this snapshot was assembled. */
  collectedAt: string;
}

/** Provider id -> default snapshot filename under ~/.claude/. Order = auto-probe order. */
export const PROVIDER_SNAPSHOT_FILES: Record<string, string> = {
  glm: 'glm-usage-snapshot.json',
  minimax: 'minimax-usage-snapshot.json',
  alibaba: 'alibaba-usage-snapshot.json',
  kimi: 'kimi-usage-snapshot.json',
};

// Sensible default when nothing in the environment declares a window size.
// Most modern coding models (GLM-5.2, Claude) ship a 200k window; GLM-5.2's 1M
// variant and Claude 1M contexts set CLAUDE_CODE_AUTO_COMPACT_WINDOW explicitly,
// so this default only matters for users on a base plan.
const FALLBACK_WINDOW_SIZE = 200_000;

// Claude Code model env vars, in the order Claude Code itself resolves them
// (opus > sonnet > haiku). Used to find a model id like "glm-5.2[1m]".
const CLAUDE_MODEL_ENV_KEYS = [
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_MODEL',
] as const;

function normalizeToken(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

/**
 * Read the last assistant turn's `message.usage` from the transcript JSONL.
 * Scans the file once, keeping the most recent assistant usage seen.
 * Returns null if the file is missing or has no usable assistant usage.
 *
 * Reads the whole file synchronously and splits lines: transcripts are bounded
 * (one session's turns), so this avoids the AsyncIterable typing friction of
 * readline while staying cheap. The status bar calls this every refresh tick,
 * but Claude Code's own transcript parser caches by mtime too, so a future
 * optimization is to skip when the file hasn't changed.
 */
export function readLastTurnUsage(transcriptPath: string): ContextTokens | null {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  let last: ContextTokens | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line || !line.trim()) continue;
    let entry: { type?: string; message?: { usage?: Record<string, unknown> } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const usage = entry.message?.usage;
    if (!usage) continue;
    last = {
      inputTokens: normalizeToken(usage.input_tokens),
      cacheCreationTokens: normalizeToken(usage.cache_creation_input_tokens),
      cacheReadTokens: normalizeToken(usage.cache_read_input_tokens),
    };
  }
  return last;
}

/** Sum input + cache_creation + cache_read = tokens occupying the context window. */
export function contextTokenTotal(t: ContextTokens): number {
  return t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}

export function computeContextPercent(t: ContextTokens | null, windowSize: number): number | null {
  if (!t || !windowSize || windowSize <= 0) {
    return null;
  }
  const pct = (contextTokenTotal(t) / windowSize) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/**
 * Accumulate token usage across the WHOLE session transcript.
 * Mirrors claude-hud's parseTranscript dedup (src/transcript.ts:383-395):
 * Claude Code can write the same API response 2-3 times consecutively, so we
 * skip consecutive duplicate usage blocks by their token-tuple fingerprint.
 * Returns null if the file is missing or has no assistant usage.
 */
export function readSessionTokenTotals(transcriptPath: string): SessionTokens | null {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const totals: SessionTokens = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  let seenAny = false;
  let lastKey: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    if (!line || !line.trim()) {
      lastKey = undefined;
      continue;
    }
    let entry: { type?: string; message?: { usage?: Record<string, unknown> } };
    try {
      entry = JSON.parse(line);
    } catch {
      lastKey = undefined;
      continue;
    }
    if (entry.type !== 'assistant') {
      lastKey = undefined;
      continue;
    }
    const usage = entry.message?.usage;
    if (!usage) {
      lastKey = undefined;
      continue;
    }
    const inT = normalizeToken(usage.input_tokens);
    const outT = normalizeToken(usage.output_tokens);
    const ccT = normalizeToken(usage.cache_creation_input_tokens);
    const crT = normalizeToken(usage.cache_read_input_tokens);
    const key = `${inT}|${outT}|${ccT}|${crT}`;
    if (key === lastKey) {
      continue; // consecutive duplicate (dual-logged API response)
    }
    lastKey = key;
    seenAny = true;
    totals.inputTokens += inT;
    totals.outputTokens += outT;
    totals.cacheCreationTokens += ccT;
    totals.cacheReadTokens += crT;
  }
  return seenAny ? totals : null;
}

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
      if (!line || !line.trim()) {
        lastKey = undefined;
        continue;
      }
      let entry: { type?: string; timestamp?: string; message?: { usage?: Record<string, unknown> } };
      try {
        entry = JSON.parse(line);
      } catch {
        lastKey = undefined;
        continue;
      }
      if (entry.type !== 'assistant' || !entry.timestamp) {
        lastKey = undefined;
        continue;
      }
      const usage = entry.message?.usage;
      if (!usage) {
        lastKey = undefined;
        continue;
      }

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

/** Per-million-token price in yuan for a model, used for cost estimation. */
export interface ModelPricing {
  /** ¥ per million input tokens. */
  input: number;
  /** ¥ per million output tokens. */
  output: number;
  /** ¥ per million cache-creation tokens (often discounted vs input). */
  cache: number;
}

/**
 * Estimate session cost in yuan from accumulated tokens + a pricing table.
 * Returns null when the model has no pricing entry. cache_read is free on
 * most providers (prompt-cache reads aren't billed separately), so it's
 * excluded from the sum.
 */
export function computeSessionCost(tokens: SessionTokens | null, pricing: ModelPricing | null): number | null {
  if (!tokens || !pricing) {
    return null;
  }
  const cost =
    (tokens.inputTokens * pricing.input +
      tokens.outputTokens * pricing.output +
      tokens.cacheCreationTokens * pricing.cache) /
    1_000_000;
  // Round to 2 decimals; values < 0.01 still show as ≈¥0.00 which is honest.
  return Math.round(cost * 100) / 100;
}

function parsePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.min(100, Math.max(0, value)));
}

function parseDate(value: unknown): Date | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Read one provider's usage snapshot. Unlike the old behavior, a STALE snapshot
 * is still returned (with status: 'stale') so the tooltip can surface a
 * "snapshot expired" badge instead of silently hiding. Only a missing/unreadable
 * file, an unparseable body, or no updated_at yields null.
 *
 * `freshnessMs === 0` disables the age check entirely (treats any age as fresh).
 */
export function readProviderSnapshot(
  provider: string,
  freshnessMs: number,
  now = Date.now(),
): ProviderUsage | null {
  const fileName = PROVIDER_SNAPSHOT_FILES[provider];
  if (!fileName) {
    return null;
  }
  const snapshotPath = path.join(getClaudeConfigDir(), fileName);

  let raw: string;
  try {
    raw = fs.readFileSync(snapshotPath, 'utf8');
  } catch {
    return null;
  }

  let parsed: {
    updated_at?: unknown;
    five_hour?: { used_percentage?: unknown; resets_at?: unknown } | null;
    seven_day?: { used_percentage?: unknown; resets_at?: unknown } | null;
    balance_label?: unknown;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const updatedAtMs = (() => {
    const d = parseDate(parsed.updated_at);
    return d ? d.getTime() : null;
  })();
  if (updatedAtMs === null) {
    return null;
  }

  const ageMs = now - updatedAtMs;
  const isStale = freshnessMs > 0 && ageMs > freshnessMs;

  const fiveHour = parsePercent(parsed.five_hour?.used_percentage);
  const sevenDay = parsePercent(parsed.seven_day?.used_percentage);
  const balance =
    typeof parsed.balance_label === 'string' && parsed.balance_label.trim()
      ? parsed.balance_label.trim().slice(0, 50)
      : null;
  if (fiveHour === null && sevenDay === null && balance === null) {
    return null;
  }

  return {
    fiveHourPercent: fiveHour,
    sevenDayPercent: sevenDay,
    fiveHourResetAt: parseDate(parsed.five_hour?.resets_at),
    sevenDayResetAt: parseDate(parsed.seven_day?.resets_at),
    balanceLabel: balance,
    provider,
    snapshotPath,
    ageMs,
    status: isStale ? 'stale' : 'fresh',
  };
}

/** Probe whether a provider snapshot exists at all (without parsing). */
export function probeProviderStatus(provider: string): SnapshotStatus {
  const fileName = PROVIDER_SNAPSHOT_FILES[provider];
  if (!fileName) return 'missing';
  try {
    fs.accessSync(path.join(getClaudeConfigDir(), fileName));
    return 'fresh';
  } catch {
    return 'missing';
  }
}

/** Resolve which provider to read: explicit setting, else probe in fixed order. */
export function resolveProviderUsage(
  providerSetting: string,
  freshnessMs: number,
  now = Date.now(),
): ProviderUsage | null {
  if (providerSetting !== 'auto') {
    return readProviderSnapshot(providerSetting, freshnessMs, now);
  }
  for (const provider of Object.keys(PROVIDER_SNAPSHOT_FILES)) {
    const snap = readProviderSnapshot(provider, freshnessMs, now);
    if (snap) {
      return snap;
    }
  }
  return null;
}

/** Read the `env` block from ~/.claude/settings.json (best-effort). */
function readSettingsEnv(): Record<string, string> {
  try {
    const raw = fs.readFileSync(getClaudeSettingsPath(), 'utf8');
    const s = JSON.parse(raw) as { env?: Record<string, string> };
    return s?.env && typeof s.env === 'object' ? s.env : {};
  } catch {
    return {};
  }
}

/**
 * Resolve the model id from Claude Code settings (e.g. "glm-5.2[1m]").
 * Checks opus > sonnet > haiku > ANTHROPIC_MODEL, returns the first defined.
 */
export function resolveModelId(env?: Record<string, string>): string {
  const e = env ?? readSettingsEnv();
  for (const key of CLAUDE_MODEL_ENV_KEYS) {
    const v = e[key];
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return '';
}

/**
 * Resolve the context window size. Priority:
 *   1. explicit user override (claudeHud.contextWindowSize > 0)
 *   2. CLAUDE_CODE_AUTO_COMPACT_WINDOW env var (the authoritative signal —
 *      Claude Code itself uses it to decide when to compact)
 *   3. window suffix on the model id: "glm-5.2[1m]" -> 1_000_000,
 *      "glm-5.2[200k]" -> 200_000
 *   4. FALLBACK_WINDOW_SIZE (200_000)
 *
 * This matters because GLM-5.2 ships both 200k and 1M variants; hardcoding
 * either would be wrong for half the users. The env var is the most reliable
 * signal since Claude Code writes it and acts on it.
 */
export function resolveContextWindowSize(override: number, env?: Record<string, string>): number {
  if (typeof override === 'number' && override > 0) {
    return override;
  }
  const e = env ?? readSettingsEnv();

  const autoCompactRaw = e.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  if (autoCompactRaw) {
    const n = Number.parseInt(autoCompactRaw, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }

  const modelId = resolveModelId(e);
  const suffix = /\[(\d+(?:\.\d+)?)([km])\]/i.exec(modelId);
  if (suffix) {
    const num = parseFloat(suffix[1]);
    const unit = suffix[2].toLowerCase();
    if (Number.isFinite(num) && num > 0) {
      return unit === 'm' ? Math.round(num * 1_000_000) : Math.round(num * 1000);
    }
  }

  return FALLBACK_WINDOW_SIZE;
}

/** Strip the [1m]/[200k] context suffix from a model id for display. */
function stripContextSuffix(modelId: string): string {
  return modelId.replace(/\s*\[\d+(?:\.\d+)?[km]\]\s*$/i, '');
}

/** Map an ANTHROPIC_BASE_URL host to a short provider label. */
function providerLabelFromBaseUrl(baseUrl: string): string {
  const host = baseUrl.toLowerCase();
  if (host.includes('bigmodel') || host.includes('glm')) return 'GLM';
  if (host.includes('minimax')) return 'MiniMax';
  if (host.includes('dashscope') || host.includes('alibaba') || host.includes('aliyun')) return 'Alibaba';
  if (host.includes('moonshot') || host.includes('kimi')) return 'Kimi';
  if (host.includes('anthropic')) return 'Claude';
  return '';
}

/**
 * Infer a model display name. Priority:
 *   1. explicit override label (caller-provided, from claudeHud.modelLabel)
 *   2. model id from settings (e.g. "glm-5.2[1m]" -> "GLM-5.2"), with the
 *      context suffix stripped so it isn't redundant with the context bar
 *   3. provider label derived from ANTHROPIC_BASE_URL (e.g. "GLM")
 *   4. 'Claude' fallback
 */
export function inferModelLabel(override: string): string {
  const trimmed = override.trim();
  if (trimmed) {
    return trimmed;
  }
  const env = readSettingsEnv();

  const modelId = resolveModelId(env);
  if (modelId) {
    // Normalize: uppercase GLM prefix, strip context suffix, tidy dashes.
    const stripped = stripContextSuffix(modelId);
    const normalized = stripped
      .replace(/^glm[-_]?/i, 'GLM-')
      .replace(/^claude[-_]?/i, 'Claude ')
      .trim();
    if (normalized) {
      return normalized;
    }
  }

  const baseUrl = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : '';
  const label = providerLabelFromBaseUrl(baseUrl);
  return label || 'Claude';
}

/**
 * Assemble the full snapshot. workspaceFolder is the VSCode workspace path
 * used to locate the transcript; transcriptPath may be passed in directly when
 * already resolved (avoids a second resolve call).
 */
export function collectHudSnapshot(
  workspaceFolder: string,
  transcriptPath: string | null,
  options: {
    windowSize?: number;
    modelLabelOverride?: string;
    providerSetting?: string;
    snapshotFreshnessMs?: number;
    /** Per-model pricing table (¥/M tokens), for session cost estimation. */
    pricing?: Record<string, ModelPricing>;
    /** How the transcriptPath was matched to the workspace (from resolveActiveTranscript). */
    transcriptMatchStrategy?: HudSnapshot['transcriptMatchStrategy'];
  } = {},
): HudSnapshot {
  const windowSize = resolveContextWindowSize(options.windowSize ?? 0);
  const providerSetting = options.providerSetting ?? 'auto';
  const freshnessMs = options.snapshotFreshnessMs ?? 600_000;

  const modelId = resolveModelId();

  let contextTokens: ContextTokens | null = null;
  let sessionTokens: SessionTokens | null = null;
  if (transcriptPath) {
    contextTokens = readLastTurnUsage(transcriptPath);
    sessionTokens = readSessionTokenTotals(transcriptPath);
  }

  const usage = resolveProviderUsage(providerSetting, freshnessMs);

  // Status for the badge: prefer the snapshot's own status, else probe existence.
  let snapshotStatus: SnapshotStatus = 'missing';
  if (usage) {
    snapshotStatus = usage.status;
  } else {
    // No usable snapshot data — was the file absent, or just stale/empty?
    const target = providerSetting === 'auto' ? firstExistingProvider() : providerSetting;
    if (target) {
      const probe = readProviderSnapshot(target, freshnessMs);
      snapshotStatus = probe ? probe.status : probeProviderStatus(target);
    }
  }

  const hourlyBuckets = workspaceFolder
    ? readHourlyUsage(path.join(getProjectsDir(), encodeProjectDir(workspaceFolder)), Date.now())
    : [];

  // Cost: look up pricing by exact model id, then by the suffix-stripped form.
  const pricing = options.pricing ?? {};
  const pricingEntry = pricing[modelId] ?? pricing[stripContextSuffix(modelId)] ?? null;
  const sessionCostYuan = computeSessionCost(sessionTokens, pricingEntry);

  return {
    contextPercent: computeContextPercent(contextTokens, windowSize),
    contextTokens,
    windowSize,
    usage,
    modelLabel: inferModelLabel(options.modelLabelOverride ?? ''),
    transcriptPath,
    workspaceFolder,
    transcriptMatchStrategy: options.transcriptMatchStrategy ?? (transcriptPath ? 'exact' : 'none'),
    sessionTokens,
    sessionCostYuan,
    modelId,
    snapshotStatus,
    hourlyBuckets,
    collectedAt: new Date().toISOString(),
  };
}

/** First provider (in probe order) whose snapshot file exists. */
function firstExistingProvider(): string | null {
  for (const provider of Object.keys(PROVIDER_SNAPSHOT_FILES)) {
    if (probeProviderStatus(provider) !== 'missing') {
      return provider;
    }
  }
  return null;
}

/** Re-exported so callers can read home dir consistently. */
export const homeDir = (): string => os.homedir();
