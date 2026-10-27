export class AiNotConfiguredError extends Error {
  readonly code = 'ai_not_configured';
  constructor(message = 'Add an AI provider API key in Settings to run this step.') {
    super(message);
  }
}

export class AiProviderError extends Error {
  readonly code = 'ai_provider_error';
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
    readonly providerCode?: string,
  ) {
    super(message);
  }
}

export class AiOutputError extends Error {
  readonly code = 'ai_output_error';
  constructor(
    message: string,
    readonly raw?: string,
  ) {
    super(message);
  }
}

export function describeAiError(err: unknown): string {
  if (err instanceof AiNotConfiguredError) return err.message;
  if (err instanceof AiProviderError) {
    if (err.status === 401 || err.status === 403) return 'The AI provider rejected the API key. Check it in Settings.';
    if (err.status === 429) return 'The AI provider is rate-limiting requests. Wait a minute and retry.';
    if (err.status === 529 || err.status === 503) return 'The AI provider is overloaded right now. Retry in a few minutes.';
    if (err.status === 400) return `The AI provider rejected the request: ${err.message}`;
    return `AI provider error (${err.status}): ${err.message}`;
  }
  if (err instanceof AiOutputError) return `The AI response could not be used: ${err.message}`;
  if (err instanceof Error && err.name === 'AbortError') return 'The AI request was cancelled or timed out.';
  return err instanceof Error ? err.message : String(err);
}
