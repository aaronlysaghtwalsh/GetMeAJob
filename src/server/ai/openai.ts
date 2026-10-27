import { AiProviderError } from './errors';
import { parseSSE } from './sse';
import { emptyUsage, type AIProvider, type Citation, type ContentPart, type ModelCapabilities, type ProviderRequest, type ProviderResponse, type TextSegment } from './types';

type Json = Record<string, any>;

async function postJson(url: string, apiKey: string, body: Json, signal?: AbortSignal, stream = false): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...(stream ? { accept: 'text/event-stream' } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new AiProviderError(`Network error contacting the AI provider: ${(err as Error).message}`, 0, true);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let message = text.slice(0, 500);
    try {
      message = JSON.parse(text)?.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    const retryAfter = Number(resp.headers.get('retry-after'));
    throw new AiProviderError(
      message || resp.statusText,
      resp.status,
      [408, 409, 429, 500, 502, 503, 504].includes(resp.status),
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
  }
  return resp;
}

/** OpenAI Responses API: native JSON-schema outputs and hosted web search with URL citations. */
export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;

  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.openai.com/v1',
  ) {}

  capabilities(): ModelCapabilities {
    return { structuredOutputs: true, webSearch: true, vision: true, pdfInput: true, effort: true, adaptiveThinking: false };
  }

  private toInput(content: string | ContentPart[]): Json[] {
    if (typeof content === 'string') return [{ type: 'input_text', text: content }];
    return content.map((p) => {
      if (p.type === 'text') return { type: 'input_text', text: p.text };
      if (p.type === 'image') return { type: 'input_image', image_url: `data:${p.mediaType};base64,${p.data}` };
      return { type: 'input_file', filename: p.filename ?? 'document.pdf', file_data: `data:application/pdf;base64,${p.data}` };
    });
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const body: Json = {
      model: req.model,
      instructions: req.system.map((s) => s.text).join('\n\n'),
      input: req.messages.map((m) => ({ role: m.role, content: m.role === 'user' ? this.toInput(m.content) : typeof m.content === 'string' ? m.content : '' })),
      max_output_tokens: req.maxTokens,
      store: false,
      stream: true,
    };
    if (req.effort) body.reasoning = { effort: req.effort };
    if (req.jsonSchema) body.text = { format: { type: 'json_schema', name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } };
    if (req.webSearch) body.tools = [{ type: 'web_search' }];

    const resp = await postJson(`${this.baseUrl}/responses`, this.apiKey, body, req.signal, true);
    let final: Json | null = null;
    for await (const { data } of parseSSE(resp.body!)) {
      if (!data || data === '[DONE]') continue;
      let ev: Json;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      if (ev.type === 'response.completed' || ev.type === 'response.incomplete') final = ev.response;
      else if (ev.type === 'response.failed') throw new AiProviderError(ev.response?.error?.message ?? 'The response failed.', 500, true);
      else if (ev.type === 'error') throw new AiProviderError(ev.message ?? ev.error?.message ?? 'Stream error', 500, true);
    }
    if (!final) throw new AiProviderError('The response stream ended unexpectedly.', 0, true);

    let text = '';
    const citations: Citation[] = [];
    const segments: TextSegment[] = [];
    const searchQueries: string[] = [];
    for (const item of final.output ?? []) {
      if (item.type === 'message') {
        for (const part of item.content ?? []) {
          if (part.type === 'output_text') {
            const partText = String(part.text ?? '');
            text += partText;
            // Split the text at annotation end positions so each segment carries its citations.
            const anns = (part.annotations ?? []).filter((a: Json) => a.type === 'url_citation' && a.url).sort((a: Json, b: Json) => (a.end_index ?? 0) - (b.end_index ?? 0));
            let cursor = 0;
            for (const a of anns) {
              const end = typeof a.end_index === 'number' ? a.end_index : partText.length;
              const cited = typeof a.start_index === 'number' ? partText.slice(a.start_index, end) : '';
              const c = { url: a.url, title: a.title ?? '', citedText: cited.slice(0, 300) };
              citations.push(c);
              if (end > cursor) {
                segments.push({ text: partText.slice(cursor, end), citations: [c] });
                cursor = end;
              } else if (segments.length) segments[segments.length - 1].citations.push(c);
            }
            if (cursor < partText.length) segments.push({ text: partText.slice(cursor), citations: [] });
          } else if (part.type === 'refusal') {
            throw new AiProviderError('The model declined to produce this output.', 400, false, undefined, 'refusal');
          }
        }
      } else if (item.type === 'web_search_call' && item.action?.query) {
        searchQueries.push(String(item.action.query));
      }
    }
    const usage = emptyUsage();
    usage.inputTokens = Number(final.usage?.input_tokens ?? 0);
    usage.outputTokens = Number(final.usage?.output_tokens ?? 0);
    usage.cacheReadTokens = Number(final.usage?.input_tokens_details?.cached_tokens ?? 0);
    usage.webSearches = searchQueries.length;
    const stopReason = final.status === 'incomplete' ? (final.incomplete_details?.reason ?? 'incomplete') : 'end_turn';
    const searchResults = dedupeBy(
      citations.map((c) => ({ url: c.url, title: c.title, pageAge: '' })),
      (r) => r.url,
    );
    return { text, segments, citations, searchResults, searchQueries, stopReason, usage, model: final.model ?? req.model };
  }
}

/**
 * Any OpenAI-compatible Chat Completions endpoint (Gemini's OpenAI endpoint, OpenRouter, Ollama, LM Studio...).
 * No hosted web search; JSON is requested via response_format and validated afterwards.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai_compatible' as const;

  constructor(
    private apiKey: string,
    private baseUrl: string,
  ) {}

  capabilities(): ModelCapabilities {
    return { structuredOutputs: false, webSearch: false, vision: true, pdfInput: false, effort: false, adaptiveThinking: false };
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const messages: Json[] = [];
    const system = req.system.map((s) => s.text).join('\n\n');
    if (system) messages.push({ role: 'system', content: system });
    for (const m of req.messages) {
      if (typeof m.content === 'string') messages.push({ role: m.role, content: m.content });
      else
        messages.push({
          role: m.role,
          content: m.content
            .filter((p) => p.type !== 'pdf')
            .map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${(p as any).mediaType};base64,${(p as any).data}` } })),
        });
    }
    const body: Json = { model: req.model, messages, max_tokens: req.maxTokens };
    if (req.jsonSchema) body.response_format = { type: 'json_object' };
    const resp = await postJson(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, this.apiKey, body, req.signal);
    const data = (await resp.json()) as Json;
    const choice = data.choices?.[0];
    const usage = emptyUsage();
    usage.inputTokens = Number(data.usage?.prompt_tokens ?? 0);
    usage.outputTokens = Number(data.usage?.completion_tokens ?? 0);
    return {
      text: String(choice?.message?.content ?? ''),
      segments: [{ text: String(choice?.message?.content ?? ''), citations: [] }],
      citations: [],
      searchResults: [],
      searchQueries: [],
      stopReason: choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
      usage,
      model: data.model ?? req.model,
    };
  }
}

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
