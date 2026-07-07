// Typed accessors for the extension's configuration settings.
import * as vscode from 'vscode';
import type { ModelPricing } from './usage-data';

const SECTION = 'claudeHud';

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export interface HudSettings {
  contextWindowSize: number;
  modelLabel: string;
  snapshotFreshnessMs: number;
  refreshIntervalMs: number;
  provider: 'auto' | 'glm' | 'minimax' | 'alibaba' | 'kimi';
  /** model id -> per-million-token yuan pricing, for cost estimation. */
  pricing: Record<string, ModelPricing>;
}

/**
 * Built-in pricing defaults (¥ per million tokens), keyed by the model id as it
 * appears in Claude Code settings. Used when the user hasn't overridden
 * claudeHud.pricing. `cache` is the prompt-cache CREATION (write) price; on
 * Zhipu most models don't publish a separate write rate, so we use the input
 * rate as a conservative upper bound (cache READ is free and isn't counted —
 * see computeSessionCost).
 *
 * Sources: bigmodel.cn/pricing public list prices (Jul 2026). GLM Coding Plan
 * subscribers pay a flat subscription and these per-token rates only matter as
 * a cost proxy / for pay-as-you-go — override claudeHud.pricing with your
 * plan's effective rates for accuracy.
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // GLM-5.x flagship (1M context) — list price ¥/M tokens.
  'glm-5.2': { input: 8, output: 28, cache: 8 },
  // GLM-4.7 — ¥4/M in, ¥16/M out.
  'glm-4.7': { input: 4, output: 16, cache: 4 },
  // GLM-4.5 / GLM-4.5-Air — ¥0.8/M in, ¥2/M out (cache hit ~¥0.16; write≈in).
  'glm-4.5': { input: 0.8, output: 2, cache: 0.8 },
  'glm-4.5-air': { input: 0.8, output: 2, cache: 0.8 },
  // GLM-4-Plus flagship — ¥5/M both in & out (post Apr-2025 90% cut).
  'glm-4-plus': { input: 5, output: 5, cache: 5 },
  // GLM-4-Air — ¥0.5/M both.
  'glm-4-air': { input: 0.5, output: 0.5, cache: 0.5 },
  // GLM-4-FlashX — ¥0.1/M both (entry tier).
  'glm-4-flashx': { input: 0.1, output: 0.1, cache: 0.1 },
};

export function readSettings(): HudSettings {
  const c = cfg();
  const userPricing = c.get<Record<string, ModelPricing>>('pricing', {});
  // User overrides take precedence; defaults fill the gaps.
  const pricing = { ...DEFAULT_PRICING, ...userPricing };
  return {
    contextWindowSize: c.get<number>('contextWindowSize', 0),
    modelLabel: c.get<string>('modelLabel', ''),
    snapshotFreshnessMs: c.get<number>('snapshotFreshnessMs', 600_000),
    refreshIntervalMs: c.get<number>('refreshIntervalMs', 2000),
    provider: c.get<'auto' | 'glm' | 'minimax' | 'alibaba' | 'kimi'>('provider', 'auto'),
    pricing,
  };
}
