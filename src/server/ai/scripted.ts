import { AiProviderError } from './errors';
import { emptyUsage, type AIProvider, type Citation, type ModelCapabilities, type ProviderRequest, type ProviderResponse, type SearchResult } from './types';

/**
 * TEST-ONLY provider. Returns deterministic responses registered per schema name so the full
 * pipeline (parsing, integrity checks, rendering, UI) can be exercised without network access.
 * It is only active when the server is started with FORCE_AI_PROVIDER=scripted.
 */
export type ScriptedResult = unknown | { __research: true; segments: { text: string; citations: Citation[] }[]; searchResults: SearchResult[]; queries: string[] };
export type ScriptedHandler = (req: ProviderRequest, promptText: string) => ScriptedResult | Promise<ScriptedResult>;

export class ScriptedProvider implements AIProvider {
  readonly id = 'scripted' as const;
  readonly calls: { name: string; req: ProviderRequest }[] = [];
  private handlers = new Map<string, ScriptedHandler>();
  /** Optional artificial latency so UI progress states are visible in E2E runs. */
  delayMs = 0;

  on(name: string, handler: ScriptedHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  capabilities(): ModelCapabilities {
    return { structuredOutputs: true, webSearch: true, vision: true, pdfInput: true, effort: true, adaptiveThinking: false };
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    // Structured calls may describe their schema in the prompt instead of sending it natively
    // (see PROMPT_SCHEMA_TASKS in service.ts), so fall back to the schema name metadata.
    const name = req.jsonSchema?.name ?? req.schemaName ?? (req.webSearch ? 'research' : 'text');
    this.calls.push({ name, req });
    const handler = this.handlers.get(name);
    if (!handler) throw new AiProviderError(`No scripted response registered for "${name}"`, 500, false);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const promptText = [
      ...req.system.map((s) => s.text),
      ...req.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n'))),
    ].join('\n');
    const out = await handler(req, promptText);
    const usage = emptyUsage();
    usage.inputTokens = Math.round(promptText.length / 4);
    if (out && typeof out === 'object' && '__research' in (out as object)) {
      const r = out as { segments: { text: string; citations: Citation[] }[]; searchResults: SearchResult[]; queries: string[] };
      const text = r.segments.map((s) => s.text).join('');
      usage.outputTokens = Math.round(text.length / 4);
      usage.webSearches = r.queries.length;
      return { text, segments: r.segments, citations: r.segments.flatMap((s) => s.citations), searchResults: r.searchResults, searchQueries: r.queries, stopReason: 'end_turn', usage, model: 'scripted-model' };
    }
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    usage.outputTokens = Math.round(text.length / 4);
    return { text, segments: [{ text, citations: [] }], citations: [], searchResults: [], searchQueries: [], stopReason: 'end_turn', usage, model: 'scripted-model' };
  }
}
