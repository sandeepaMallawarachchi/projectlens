export type AIErrorKind =
  | 'no-key'
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'model'
  | 'bad-request'
  | 'too-large'
  | 'rate-limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'cancelled'
  | 'invalid-response'
  | 'limit'
  | 'consent-declined'
  | 'unsupported-format'
  | 'refused'
  | 'unknown';

const RETRYABLE: ReadonlySet<AIErrorKind> = new Set(['rate-limit', 'server', 'timeout', 'network']);

export class AIError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly kind: AIErrorKind,
    message: string,
    readonly options: { status?: number; retryAfterMs?: number; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'AIError';
    this.retryable = RETRYABLE.has(kind);
  }

  get status(): number | undefined {
    return this.options.status;
  }

  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }
}

/** User-facing guidance for each error kind. */
export function describeAIError(err: unknown, provider = 'the AI provider'): string {
  if (!(err instanceof AIError)) {
    return err instanceof Error ? err.message : String(err);
  }
  switch (err.kind) {
    case 'no-key':
      return `No ${provider} API key is configured. Run "ProjectLens: Set AI API Key".`;
    case 'auth':
      return `${provider} rejected the API key (${err.status ?? 401}). Check or replace it with "ProjectLens: Set AI API Key".`;
    case 'forbidden':
      return `${provider} denied access (403). The key may lack permission for this model or your organization/region is restricted. ${err.message}`;
    case 'model':
    case 'not-found':
      return `The selected model is unavailable: ${err.message}. Pick another model with "ProjectLens: Select AI Model".`;
    case 'rate-limit':
      return `${provider} rate limit reached (429).${err.retryAfterMs ? ` Retry after ~${Math.ceil(err.retryAfterMs / 1000)} s.` : ''} Try again later or lower request volume.`;
    case 'server':
      return `${provider} is temporarily unavailable (${err.status ?? '5xx'}). Please retry shortly.`;
    case 'timeout':
      return `The ${provider} request timed out. Retry, or increase projectlens.ai.requestTimeoutSeconds.`;
    case 'network':
      return `Could not reach ${provider}. Check your internet connection or proxy settings. Local analysis keeps working offline.`;
    case 'refused':
      return `${provider} declined to answer: ${err.message} Try a different task or model.`;
    case 'too-large':
      return 'The request was too large for the model. Lower projectlens.ai.maxContextTokens or review a smaller scope.';
    case 'invalid-response':
      return `The model returned output that failed validation and was discarded. ${err.message}`;
    case 'limit':
      return err.message;
    case 'cancelled':
      return 'AI request cancelled.';
    case 'consent-declined':
      return 'AI request cancelled — nothing was sent.';
    default:
      return err.message;
  }
}
