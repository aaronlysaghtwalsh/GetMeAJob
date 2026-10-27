import type { AITask, Effort, ModelRole, ProviderId } from './types';

export interface TaskConfig {
  role: ModelRole;
  effort: Effort;
  maxTokens: number;
}

/** Each logical task maps to a model role plus sensible reasoning effort and output budget. */
export const TASK_CONFIG: Record<AITask, TaskConfig> = {
  extract: { role: 'extraction', effort: 'low', maxTokens: 32000 },
  vision: { role: 'extraction', effort: 'low', maxTokens: 16000 },
  consolidate: { role: 'reasoning', effort: 'medium', maxTokens: 32000 },
  discovery: { role: 'reasoning', effort: 'medium', maxTokens: 16000 },
  answer_integration: { role: 'extraction', effort: 'low', maxTokens: 8000 },
  job: { role: 'extraction', effort: 'low', maxTokens: 16000 },
  research: { role: 'research', effort: 'medium', maxTokens: 16000 },
  research_structure: { role: 'extraction', effort: 'low', maxTokens: 16000 },
  fit: { role: 'reasoning', effort: 'medium', maxTokens: 24000 },
  strategy: { role: 'reasoning', effort: 'medium', maxTokens: 24000 },
  resume: { role: 'writing', effort: 'medium', maxTokens: 32000 },
  cover_letter: { role: 'writing', effort: 'medium', maxTokens: 16000 },
  answer: { role: 'writing', effort: 'medium', maxTokens: 12000 },
  review: { role: 'reasoning', effort: 'medium', maxTokens: 24000 },
  test: { role: 'extraction', effort: 'low', maxTokens: 1000 },
};

export const MODEL_ROLE_LABEL: Record<ModelRole, string> = {
  extraction: 'Extraction & parsing',
  reasoning: 'Reasoning & strategy',
  writing: 'Writing',
  research: 'Company research',
};

export const DEFAULT_MODELS: Record<Exclude<ProviderId, 'scripted'>, Partial<Record<ModelRole, string>>> = {
  anthropic: {
    extraction: 'claude-sonnet-5-5',
    reasoning: 'claude-opus-5-5',
    writing: 'claude-opus-5-5',
    research: 'claude-sonnet-5-5',
  },
  openai: {
    extraction: 'gpt-6-astra',
    reasoning: 'gpt-6-astra',
    writing: 'gpt-6-astra',
    research: 'gpt-6-astra',
  },
  openai_compatible: {},
};

export const SUGGESTED_MODELS: Record<Exclude<ProviderId, 'scripted'>, string[]> = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-fable-5-1'],
  openai: ['gpt-6-astra'],
  openai_compatible: [],
};

/** USD per million tokens. Used for cost estimates only; unknown models show tokens without cost. */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const WEB_SEARCH_USD = 10 / 1000;

export function estimateCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; webSearches: number },
): number | null {
  const price = PRICING[model] ?? Object.entries(PRICING).find(([k]) => model.startsWith(k))?.[1];
  if (!price) return null;
  const cost =
    (usage.inputTokens * price.input + usage.cacheWriteTokens * price.input * 1.25 + usage.cacheReadTokens * price.input * 0.1 + usage.outputTokens * price.output) /
      1_000_000 +
    usage.webSearches * WEB_SEARCH_USD;
  return Math.round(cost * 10000) / 10000;
}

/** Web searches allowed per research depth. */
export const RESEARCH_SEARCHES: Record<'standard' | 'deep' | 'maximum', number> = {
  standard: 3,
  deep: 7,
  maximum: 14,
};
