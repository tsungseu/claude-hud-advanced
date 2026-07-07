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
 * claudeHud.pricing. Values are public list prices; cache is often billed at
 * the input rate or discounted — treated here as equal to input for a
 * conservative (upper-bound) estimate.
 *
 * Sources: provider public pricing pages. Users should override with their
 * actual plan rates for accuracy.
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // GLM coding plan public pricing (¥/M tokens).
  'glm-4.7': { input: 0.5, output: 0.5, cache: 0.5 },
  'glm-5.2': { input: 2, output: 8, cache: 2 },
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
