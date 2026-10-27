import type { ZodType } from 'zod/v4';
import type { App } from '../app';
import { newId, nowIso } from '../lib/ids';
import { getSecrets, getSettings, type UserSettings } from '../repos/settings';
import { AnthropicProvider } from './anthropic';
import { AiNotConfiguredError, AiOutputError, AiProviderError, describeAiError } from './errors';
import { OpenAICompatibleProvider, OpenAIProvider } from './openai';
import { DEFAULT_MODELS, estimateCostUsd, TASK_CONFIG } from './registry';
import { extractJson, toProviderJsonSchema, validateOutput } from './schema';
import { ScriptedProvider } from './scripted';
import { addUsage, emptyUsage, type AIProvider, type AITask, type ContentPart, type Effort, type ProviderId, type ProviderRequest, type ProviderResponse, type Usage } from './types';

export interface StructuredCall<T> {
  userId: string;
  taskId?: string | null;
  task: AITask;
  purpose: string;
  /** Large shared context placed first (cacheable), e.g. the Career Brain. */
  context?: string;
  /** Task instructions. */
  system: string;
  prompt: string | ContentPart[];
  schema: ZodType<T>;
  schemaName: string;
  signal?: AbortSignal;
  effort?: Effort;
}

export interface ResearchCall {
  userId: string;
  taskId?: string | null;
  purpose: string;
  system: string;
  prompt: string;
  maxSearches: number;
  location?: { city?: string; region?: string; country?: string };
  signal?: AbortSignal;
}

export interface ResearchOutcome {
  webSearchUsed: boolean;
  text: string;
  segments: ProviderResponse['segments'];
  citations: ProviderResponse['citations'];
  searchResults: ProviderResponse['searchResults'];
  queries: string[];
}

export interface AiStatus {
  configured: boolean;
  provider: ProviderId;
  keySource: 'user' | 'environment' | null;
  models: Record<string, string>;
  webSearch: boolean;
  message: string | null;
}

/**
 * Tasks that do not use native structured outputs. In live use on 7 Oct 2026 the Anthropic API
 * rejected resume extraction, job analysis and strategy requests with "The compiled grammar is too
 * large" (their schemas are big); fit analysis and research structuring were moved here at the same
 * time. For these tasks the JSON Schema is written into the instructions instead. The output is still
 * validated with zod and retried on failure, exactly as for native structured outputs.
 */
export const PROMPT_SCHEMA_TASKS: ReadonlySet<AITask> = new Set<AITask>(['extract', 'job', 'fit', 'research_structure', 'strategy']);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    });
  });

/**
 * Facade over AI providers: resolves the user's provider/models/keys, enforces structured output
 * (native JSON-schema where supported, validated with zod either way), retries transient failures,
 * and records every call in ai_runs for transparency and future usage limits.
 */
export class AIService {
  private scripted?: ScriptedProvider;

  constructor(private app: App) {
    if (app.config.forcedProvider === 'scripted') this.scripted = new ScriptedProvider();
  }

  /** Test hook: access the scripted provider to register fixtures. */
  get scriptedProvider(): ScriptedProvider | undefined {
    return this.scripted;
  }

  private resolve(userId: string, task: AITask): { provider: AIProvider; model: string; settings: UserSettings } {
    const settings = getSettings(this.app.db, userId);
    if (this.scripted) return { provider: this.scripted, model: 'scripted-model', settings };
    const secrets = getSecrets(this.app.db, userId, this.app.keys.secrets);
    const role = TASK_CONFIG[task].role;
    const choice = settings.provider;
    const model = settings.models[role] || DEFAULT_MODELS[choice][role] || '';
    if (choice === 'anthropic') {
      const key = secrets.anthropic || this.app.config.env_keys.anthropic;
      if (!key) throw new AiNotConfiguredError();
      return { provider: new AnthropicProvider(key), model, settings };
    }
    if (choice === 'openai') {
      const key = secrets.openai || this.app.config.env_keys.openai;
      if (!key) throw new AiNotConfiguredError();
      return { provider: new OpenAIProvider(key), model, settings };
    }
    const key = secrets.openai_compatible || '';
    const base = settings.compatibleBaseUrl || this.app.config.env_keys.openaiBaseUrl || '';
    if (!base) throw new AiNotConfiguredError('Set the base URL for your OpenAI-compatible provider in Settings.');
    if (!model) throw new AiNotConfiguredError('Choose a model for your OpenAI-compatible provider in Settings.');
    return { provider: new OpenAICompatibleProvider(key || 'none', base), model, settings };
  }

  status(userId: string): AiStatus {
    const settings = getSettings(this.app.db, userId);
    if (this.scripted) {
      return { configured: true, provider: 'scripted', keySource: 'environment', models: {}, webSearch: true, message: null };
    }
    const secrets = getSecrets(this.app.db, userId, this.app.keys.secrets);
    const choice = settings.provider;
    const userKey = secrets[choice];
    const envKey = choice === 'anthropic' ? this.app.config.env_keys.anthropic : choice === 'openai' ? this.app.config.env_keys.openai : undefined;
    const models: Record<string, string> = {};
    for (const role of ['extraction', 'reasoning', 'writing', 'research'] as const) {
      models[role] = settings.models[role] || DEFAULT_MODELS[choice][role] || '';
    }
    let configured = Boolean(userKey || envKey);
    let message: string | null = configured ? null : 'Add an API key in Settings to enable AI features.';
    if (choice === 'openai_compatible') {
      configured = Boolean((settings.compatibleBaseUrl || this.app.config.env_keys.openaiBaseUrl) && models.reasoning);
      message = configured ? null : 'Set a base URL and model names for your OpenAI-compatible provider.';
    }
    return {
      configured,
      provider: choice,
      keySource: userKey ? 'user' : envKey ? 'environment' : null,
      models,
      webSearch: choice !== 'openai_compatible',
      message,
    };
  }

  private async call(provider: AIProvider, req: ProviderRequest): Promise<ProviderResponse> {
    const maxAttempts = 4;
    for (let attempt = 0; ; attempt++) {
      try {
        return await provider.generate(req);
      } catch (err) {
        const retryable = err instanceof AiProviderError && err.retryable;
        if (!retryable || attempt >= maxAttempts - 1) throw err;
        const wait = Math.min(30_000, (err as AiProviderError).retryAfterMs ?? 2000 * 2 ** attempt + Math.random() * 500);
        this.app.log(`AI call failed (${(err as Error).message}); retrying in ${Math.round(wait)}ms`);
        await sleep(wait, req.signal);
      }
    }
  }

  private record(entry: {
    userId: string;
    taskId?: string | null;
    purpose: string;
    provider: string;
    model: string;
    usage: Usage;
    durationMs: number;
    status: 'ok' | 'error';
    error?: string;
  }) {
    const cost = estimateCostUsd(entry.model, entry.usage);
    this.app.db.run(
      `INSERT INTO ai_runs (id, user_id, task_id, purpose, provider, model, input_tokens, output_tokens, cache_read_tokens, web_searches, cost_usd, duration_ms, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('air'),
        entry.userId,
        entry.taskId ?? null,
        entry.purpose,
        entry.provider,
        entry.model,
        entry.usage.inputTokens + entry.usage.cacheWriteTokens,
        entry.usage.outputTokens,
        entry.usage.cacheReadTokens,
        entry.usage.webSearches,
        cost ?? 0,
        entry.durationMs,
        entry.status,
        entry.error ?? null,
        nowIso(),
      ],
    );
  }

  /** Generate a JSON object that validates against `schema`. */
  async structured<T>(call: StructuredCall<T>): Promise<T> {
    const { provider, model } = this.resolve(call.userId, call.task);
    const cfg = TASK_CONFIG[call.task];
    const caps = provider.capabilities(model);
    const jsonSchema = toProviderJsonSchema(call.schema);
    const useNativeStructuredOutput = caps.structuredOutputs && !PROMPT_SCHEMA_TASKS.has(call.task);
    const system: ProviderRequest['system'] = [];
    if (call.context) system.push({ text: call.context, cache: true });
    let instructions = call.system;
    if (!useNativeStructuredOutput) {
      instructions += `\n\nRespond with ONLY a JSON object (no prose, no code fences) that validates against this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
    }
    system.push({ text: instructions });

    const messages: ProviderRequest['messages'] = [{ role: 'user', content: call.prompt }];
    let maxTokens = cfg.maxTokens;
    let usage = emptyUsage();
    const started = Date.now();
    let lastError = '';
    let lastText = '';

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const resp = await this.call(provider, {
          model,
          system,
          messages,
          maxTokens,
          effort: call.effort ?? cfg.effort,
          jsonSchema: useNativeStructuredOutput ? { name: call.schemaName, schema: jsonSchema } : undefined,
          schemaName: call.schemaName,
          signal: call.signal,
        });
        usage = addUsage(usage, resp.usage);
        lastText = resp.text;
        if (resp.stopReason === 'max_tokens' || resp.stopReason === 'max_output_tokens') {
          lastError = 'The response was cut off (output limit reached).';
          maxTokens = Math.min(64000, Math.round(maxTokens * 1.6));
          continue;
        }
        let parsed: unknown;
        try {
          parsed = extractJson(resp.text);
        } catch (err) {
          lastError = (err as Error).message;
          messages.push({ role: 'assistant', content: resp.text.slice(0, 20000) || '(empty)' });
          messages.push({ role: 'user', content: 'That was not valid JSON. Return only the JSON object, matching the schema exactly.' });
          continue;
        }
        const result = validateOutput(call.schema, parsed);
        if (result.ok) {
          this.record({ userId: call.userId, taskId: call.taskId, purpose: call.purpose, provider: provider.id, model, usage, durationMs: Date.now() - started, status: 'ok' });
          return result.data;
        }
        lastError = result.error;
        messages.push({ role: 'assistant', content: resp.text.slice(0, 20000) });
        messages.push({ role: 'user', content: `The JSON failed validation: ${result.error}. Return the corrected JSON object only.` });
      }
      throw new AiOutputError(lastError || 'Invalid output', lastText.slice(0, 2000));
    } catch (err) {
      this.record({
        userId: call.userId,
        taskId: call.taskId,
        purpose: call.purpose,
        provider: provider.id,
        model,
        usage,
        durationMs: Date.now() - started,
        status: 'error',
        error: describeAiError(err),
      });
      throw err;
    }
  }

  /** Free-text research with hosted web search and citations (when the provider supports it). */
  async research(call: ResearchCall): Promise<ResearchOutcome> {
    const { provider, model, settings } = this.resolve(call.userId, 'research');
    const caps = provider.capabilities(model);
    if (!caps.webSearch || call.maxSearches <= 0) {
      return { webSearchUsed: false, text: '', segments: [], citations: [], searchResults: [], queries: [] };
    }
    const cfg = TASK_CONFIG.research;
    const started = Date.now();
    let usage = emptyUsage();
    try {
      const loc = call.location ?? parseLocation(settings.researchLocation);
      const resp = await this.call(provider, {
        model,
        system: [{ text: call.system }],
        messages: [{ role: 'user', content: call.prompt }],
        maxTokens: cfg.maxTokens,
        effort: cfg.effort,
        webSearch: { maxUses: call.maxSearches, userLocation: loc },
        signal: call.signal,
      });
      usage = resp.usage;
      this.record({ userId: call.userId, taskId: call.taskId, purpose: call.purpose, provider: provider.id, model, usage, durationMs: Date.now() - started, status: 'ok' });
      return { webSearchUsed: true, text: resp.text, segments: resp.segments, citations: resp.citations, searchResults: resp.searchResults, queries: resp.searchQueries };
    } catch (err) {
      this.record({
        userId: call.userId,
        taskId: call.taskId,
        purpose: call.purpose,
        provider: provider.id,
        model,
        usage,
        durationMs: Date.now() - started,
        status: 'error',
        error: describeAiError(err),
      });
      throw err;
    }
  }

  /** Cheap connectivity check used by Settings → "Test connection". */
  async test(userId: string): Promise<{ ok: boolean; model: string; message: string }> {
    const { provider, model } = this.resolve(userId, 'test');
    try {
      const resp = await provider.generate({
        model,
        system: [{ text: 'Reply with the single word: ready' }],
        messages: [{ role: 'user', content: 'Status check.' }],
        maxTokens: provider.capabilities(model).adaptiveThinking ? 2000 : 50,
        effort: 'low',
      });
      return { ok: true, model: resp.model, message: `Connected. ${resp.model} replied: "${resp.text.trim().slice(0, 40)}"` };
    } catch (err) {
      return { ok: false, model, message: describeAiError(err) };
    }
  }
}

function parseLocation(text: string): { city?: string; region?: string; country?: string } | undefined {
  if (!text.trim()) return undefined;
  const [city, region] = text.split(',').map((s) => s.trim());
  return { city: city || undefined, region: region || undefined, country: 'US' };
}
