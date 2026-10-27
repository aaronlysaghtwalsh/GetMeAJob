export type ContentPart =
  | { type: 'text'; text: string; cache?: boolean }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'pdf'; data: string; filename?: string };

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

export type Effort = 'low' | 'medium' | 'high';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearches: a.webSearches + b.webSearches,
  };
}

export interface Citation {
  url: string;
  title: string;
  citedText: string;
}

export interface SearchResult {
  url: string;
  title: string;
  pageAge: string;
}

export interface ProviderRequest {
  model: string;
  /** System prompt blocks. Blocks with cache=true end a cacheable prefix (where supported). */
  system: { text: string; cache?: boolean }[];
  messages: AIMessage[];
  maxTokens: number;
  effort?: Effort;
  /** Ask for JSON matching this JSON Schema (native structured outputs when supported). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /**
   * Name of the expected output schema, set on every structured call, including calls that
   * describe the schema in the prompt instead of using native structured outputs. Internal
   * metadata only: real providers never send it. The scripted test provider uses it to pick
   * the right fixture.
   */
  schemaName?: string;
  webSearch?: {
    maxUses: number;
    userLocation?: { city?: string; region?: string; country?: string; timezone?: string };
  };
  signal?: AbortSignal;
}

export interface TextSegment {
  text: string;
  citations: Citation[];
}

export interface ProviderResponse {
  text: string;
  /** Text split into segments with the citations attached to each (for source-linked research). */
  segments: TextSegment[];
  citations: Citation[];
  searchResults: SearchResult[];
  searchQueries: string[];
  stopReason: string;
  usage: Usage;
  model: string;
}

export interface ModelCapabilities {
  structuredOutputs: boolean;
  webSearch: boolean;
  vision: boolean;
  pdfInput: boolean;
  effort: boolean;
  adaptiveThinking: boolean;
}

export interface AIProvider {
  readonly id: ProviderId;
  capabilities(model: string): ModelCapabilities;
  generate(req: ProviderRequest): Promise<ProviderResponse>;
}

export type ProviderId = 'anthropic' | 'openai' | 'openai_compatible' | 'scripted';

/** Logical AI task types. Each maps to a model role and default limits. */
export type AITask =
  | 'extract'
  | 'vision'
  | 'consolidate'
  | 'discovery'
  | 'answer_integration'
  | 'job'
  | 'research'
  | 'research_structure'
  | 'fit'
  | 'strategy'
  | 'resume'
  | 'cover_letter'
  | 'answer'
  | 'review'
  | 'test';

export type ModelRole = 'extraction' | 'reasoning' | 'writing' | 'research';
