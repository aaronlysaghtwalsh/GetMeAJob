import { AiProviderError } from './errors';
import { parseSSE } from './sse';
import {
  emptyUsage,
  addUsage,
  type AIMessage,
  type AIProvider,
  type Citation,
  type ContentPart,
  type ModelCapabilities,
  type ProviderRequest,
  type ProviderResponse,
  type SearchResult,
  type TextSegment,
  type Usage,
} from './types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
/** Basic web search tool version: supported by every current model, classic result blocks. */
const WEB_SEARCH_TOOL = 'web_search_20250305';
const MAX_PAUSE_CONTINUATIONS = 4;

type Block = Record<string, any>;

interface AnthropicMessage {
  id?: string;
  model?: string;
  content: Block[];
  stop_reason: string | null;
  usage: Record<string, any>;
}

/** Models with adaptive thinking + effort (Claude 4.6+ generation and later). */
function isAdaptiveModel(model: string): boolean {
  return /claude-(opus|sonnet|fable|mythos)-(4-[6-9]|[5-9])/.test(model);
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;

  constructor(
    private apiKey: string,
    private baseUrl = API_URL,
  ) {}

  capabilities(model: string): ModelCapabilities {
    const adaptive = isAdaptiveModel(model);
    return {
      structuredOutputs: true,
      webSearch: true,
      vision: true,
      pdfInput: true,
      effort: adaptive,
      adaptiveThinking: adaptive,
    };
  }

  private toContent(content: string | ContentPart[]): Block[] | string {
    if (typeof content === 'string') return content;
    return content.map((part) => {
      if (part.type === 'text') {
        const block: Block = { type: 'text', text: part.text };
        if (part.cache) block.cache_control = { type: 'ephemeral' };
        return block;
      }
      if (part.type === 'image') return { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.data } };
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: part.data } };
    });
  }

  private buildBody(req: ProviderRequest, messages: { role: string; content: unknown }[]): Record<string, unknown> {
    const caps = this.capabilities(req.model);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      stream: true,
      messages,
    };
    if (req.system.length) {
      body.system = req.system.map((s) => {
        const block: Block = { type: 'text', text: s.text };
        if (s.cache) block.cache_control = { type: 'ephemeral' };
        return block;
      });
    }
    if (caps.adaptiveThinking) body.thinking = { type: 'adaptive' };
    const outputConfig: Record<string, unknown> = {};
    if (caps.effort && req.effort) outputConfig.effort = req.effort;
    if (req.jsonSchema) outputConfig.format = { type: 'json_schema', schema: req.jsonSchema.schema };
    if (Object.keys(outputConfig).length) body.output_config = outputConfig;
    if (req.webSearch) {
      const tool: Block = { type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: req.webSearch.maxUses };
      const loc = req.webSearch.userLocation;
      if (loc && (loc.city || loc.region || loc.country || loc.timezone)) tool.user_location = { type: 'approximate', ...loc };
      body.tools = [tool];
    }
    return body;
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const messages: { role: string; content: unknown }[] = req.messages.map((m: AIMessage) => ({ role: m.role, content: this.toContent(m.content) }));
    let usage: Usage = emptyUsage();
    const allBlocks: Block[] = [];
    let stopReason = '';
    let model = req.model;

    for (let turn = 0; turn <= MAX_PAUSE_CONTINUATIONS; turn++) {
      const message = await this.send(this.buildBody(req, messages), req.signal);
      usage = addUsage(usage, convertUsage(message.usage));
      model = message.model ?? model;
      stopReason = message.stop_reason ?? '';
      allBlocks.push(...message.content);
      if (stopReason !== 'pause_turn') break;
      // Long-running server tool turn: send the paused assistant content back unchanged to continue.
      messages.push({ role: 'assistant', content: message.content });
    }

    if (stopReason === 'refusal') throw new AiProviderError('The model declined to produce this output.', 400, false, undefined, 'refusal');

    const text = allBlocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text as string)
      .join('');
    const citations: Citation[] = [];
    const segments: TextSegment[] = [];
    const searchResults: SearchResult[] = [];
    const searchQueries: string[] = [];
    for (const b of allBlocks) {
      if (b.type === 'text') {
        const segCites: Citation[] = [];
        for (const c of Array.isArray(b.citations) ? b.citations : []) {
          if (c?.url) segCites.push({ url: String(c.url), title: String(c.title ?? ''), citedText: String(c.cited_text ?? '') });
        }
        citations.push(...segCites);
        segments.push({ text: String(b.text ?? ''), citations: segCites });
      } else if (b.type === 'server_tool_use' && b.name === 'web_search' && typeof b.input?.query === 'string') {
        searchQueries.push(b.input.query);
      } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) {
          if (r?.type === 'web_search_result' && r.url) searchResults.push({ url: String(r.url), title: String(r.title ?? ''), pageAge: String(r.page_age ?? '') });
        }
      }
    }
    return { text, segments, citations, searchResults, searchQueries, stopReason, usage, model };
  }

  private async send(body: Record<string, unknown>, signal?: AbortSignal): Promise<AnthropicMessage> {
    let resp: Response;
    try {
      resp = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new AiProviderError(`Network error contacting Anthropic: ${(err as Error).message}`, 0, true);
    }
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      let message = text.slice(0, 500);
      let type: string | undefined;
      try {
        const parsed = JSON.parse(text);
        message = parsed?.error?.message ?? message;
        type = parsed?.error?.type;
      } catch {
        /* not JSON */
      }
      const retryAfter = Number(resp.headers.get('retry-after'));
      throw new AiProviderError(
        message || resp.statusText,
        resp.status,
        [408, 409, 429, 500, 502, 503, 504, 529].includes(resp.status),
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        type,
      );
    }
    return accumulateStream(resp.body);
  }
}

/** Rebuild a full Messages API response from its SSE event stream. Exported for tests. */
export async function accumulateStream(body: ReadableStream<Uint8Array>): Promise<AnthropicMessage> {
  const message: AnthropicMessage = { content: [], stop_reason: null, usage: {} };
  const partialJson = new Map<number, string>();
  for await (const { data } of parseSSE(body)) {
    if (!data) continue;
    let ev: Block;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    switch (ev.type) {
      case 'message_start': {
        const m = ev.message ?? {};
        message.id = m.id;
        message.model = m.model;
        message.usage = { ...(m.usage ?? {}) };
        break;
      }
      case 'content_block_start': {
        const block = structuredClone(ev.content_block ?? {});
        message.content[ev.index] = block;
        if (block.type === 'tool_use' || block.type === 'server_tool_use') partialJson.set(ev.index, '');
        break;
      }
      case 'content_block_delta': {
        const block = message.content[ev.index];
        const d = ev.delta ?? {};
        if (!block) break;
        if (d.type === 'text_delta') block.text = (block.text ?? '') + d.text;
        else if (d.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + d.thinking;
        else if (d.type === 'signature_delta') block.signature = (block.signature ?? '') + d.signature;
        else if (d.type === 'input_json_delta') partialJson.set(ev.index, (partialJson.get(ev.index) ?? '') + (d.partial_json ?? ''));
        else if (d.type === 'citations_delta' && d.citation) (block.citations ??= []).push(d.citation);
        break;
      }
      case 'content_block_stop': {
        const pending = partialJson.get(ev.index);
        if (pending !== undefined) {
          try {
            message.content[ev.index].input = pending ? JSON.parse(pending) : {};
          } catch {
            message.content[ev.index].input = {};
          }
          partialJson.delete(ev.index);
        }
        break;
      }
      case 'message_delta': {
        if (ev.delta?.stop_reason !== undefined) message.stop_reason = ev.delta.stop_reason;
        if (ev.usage) message.usage = { ...message.usage, ...ev.usage };
        break;
      }
      case 'error': {
        const e = ev.error ?? {};
        const overloaded = e.type === 'overloaded_error';
        throw new AiProviderError(e.message ?? 'Stream error', overloaded ? 529 : 500, true, undefined, e.type);
      }
      default:
        break;
    }
  }
  message.content = message.content.filter(Boolean);
  if (message.stop_reason === null) throw new AiProviderError('The response stream ended unexpectedly.', 0, true);
  return message;
}

function convertUsage(u: Record<string, any>): Usage {
  return {
    inputTokens: Number(u.input_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Number(u.cache_creation_input_tokens ?? 0),
    webSearches: Number(u.server_tool_use?.web_search_requests ?? 0),
  };
}
