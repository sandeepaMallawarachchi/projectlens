import Groq from 'groq-sdk';
import type { AIProvider, CompletionRequest, CompletionResponse, OutputMode } from '../AIProvider';
import { AIError } from '../errors';
import { withRetry } from '../retry';

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';

export interface GroqProviderOptions {
  getApiKey: () => Promise<string | undefined>;
  timeoutMs: () => number;
  maxRetries: () => number;
  /** Injected for tests. */
  clientFactory?: (apiKey: string, timeoutMs: number) => GroqLikeClient;
  onRetry?: (attempt: number, delayMs: number, error: AIError) => void;
}

/** The subset of the Groq SDK used by the provider (lets tests inject a fake). */
export interface GroqLikeClient {
  chat: {
    completions: {
      create(body: Record<string, unknown>, options?: { signal?: AbortSignal; timeout?: number }): {
        withResponse(): Promise<{ data: GroqCompletion; response: { headers: { get(name: string): string | null } } }>;
      };
    };
  };
  models: { list(options?: { signal?: AbortSignal }): Promise<{ data: { id: string; active?: boolean }[] }> };
}

interface GroqCompletion {
  model?: string;
  choices: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface HeadersLike {
  get?(name: string): string | null | undefined;
  [key: string]: unknown;
}

function header(headers: unknown, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  const h = headers as HeadersLike;
  if (typeof h.get === 'function') {
    return h.get(name) ?? undefined;
  }
  const v = h[name] ?? h[name.toLowerCase()];
  return typeof v === 'string' ? v : undefined;
}

export function parseRetryAfter(headers: unknown): number | undefined {
  const ms = header(headers, 'retry-after-ms');
  if (ms && !Number.isNaN(Number(ms))) {
    return Math.max(0, Number(ms));
  }
  const s = header(headers, 'retry-after');
  if (!s) {
    return undefined;
  }
  if (!Number.isNaN(Number(s))) {
    return Math.max(0, Number(s) * 1000);
  }
  const date = Date.parse(s);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Maps Groq SDK errors (or anything shaped like them) to AIError. */
export function mapGroqError(err: unknown): AIError {
  if (err instanceof AIError) {
    return err;
  }
  const e = err as { name?: string; status?: number; message?: string; headers?: unknown; error?: { error?: { message?: string; code?: string } ; message?: string; code?: string } };
  const name = e?.name ?? '';
  const apiMessage = e?.error?.error?.message ?? e?.error?.message ?? e?.message ?? 'Unknown error';
  const code = e?.error?.error?.code ?? e?.error?.code ?? '';
  if (name === 'APIUserAbortError' || name === 'AbortError' || err instanceof Groq.APIUserAbortError) {
    return new AIError('cancelled', 'Request cancelled', { cause: err });
  }
  if (name === 'APIConnectionTimeoutError' || err instanceof Groq.APIConnectionTimeoutError) {
    return new AIError('timeout', 'Request timed out', { cause: err });
  }
  if (name === 'APIConnectionError' || err instanceof Groq.APIConnectionError) {
    return new AIError('network', apiMessage, { cause: err });
  }
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status === undefined) {
    return new AIError('unknown', apiMessage, { cause: err });
  }
  const opts = { status, cause: err, retryAfterMs: parseRetryAfter(e.headers) };
  if (status === 401) {
    return new AIError('auth', apiMessage, opts);
  }
  if (status === 403) {
    return new AIError('forbidden', apiMessage, opts);
  }
  if (status === 404 || /model_not_found|model_decommissioned|does not exist/i.test(`${code} ${apiMessage}`)) {
    return new AIError('model', apiMessage, opts);
  }
  if (status === 413 || /context_length|too large|maximum context/i.test(apiMessage)) {
    return new AIError('too-large', apiMessage, opts);
  }
  if (status === 429) {
    return new AIError('rate-limit', apiMessage, opts);
  }
  if (status === 498 || status >= 500) {
    return new AIError('server', apiMessage, opts);
  }
  if (status === 400 && /response_format|json_schema|json_object|structured output|does not support/i.test(apiMessage) && !/json_validate_failed/.test(code)) {
    return new AIError('unsupported-format', apiMessage, opts);
  }
  if (status === 400 && /json_validate_failed/.test(`${code} ${apiMessage}`)) {
    return new AIError('invalid-response', apiMessage, opts);
  }
  return new AIError('bad-request', apiMessage, opts);
}

export class GroqProvider implements AIProvider {
  readonly id = 'groq';
  readonly displayName = 'Groq Cloud';
  /** Remembers which output mode works per model (avoids repeated failing requests). */
  private readonly modeByModel = new Map<string, OutputMode>();

  constructor(private readonly options: GroqProviderOptions) {}

  private async client(): Promise<GroqLikeClient> {
    const key = await this.options.getApiKey();
    if (!key) {
      throw new AIError('no-key', 'No Groq API key configured');
    }
    const timeout = this.options.timeoutMs();
    if (this.options.clientFactory) {
      return this.options.clientFactory(key, timeout);
    }
    // SDK retries are disabled: retries are handled (and bounded) by withRetry.
    return new Groq({ apiKey: key, maxRetries: 0, timeout }) as unknown as GroqLikeClient;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const client = await this.client();
    const modes: OutputMode[] = req.jsonSchema ? ['json_schema', 'json_object', 'prompt'] : ['json_object', 'prompt'];
    const known = this.modeByModel.get(req.model);
    const order = known ? modes.slice(modes.indexOf(known)) : modes;

    let lastError: AIError | undefined;
    for (const mode of order) {
      try {
        const res = await withRetry(() => this.send(client, req, mode), {
          maxRetries: this.options.maxRetries(),
          signal: req.signal,
          onRetry: this.options.onRetry
        });
        this.modeByModel.set(req.model, mode);
        return res;
      } catch (err) {
        const error = mapGroqError(err);
        // Fall back to a less strict output mode only for format-related rejections.
        if ((error.kind === 'unsupported-format' || (error.kind === 'invalid-response' && mode !== 'prompt')) && mode !== 'prompt') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new AIError('unknown', 'No output mode succeeded');
  }

  private async send(client: GroqLikeClient, req: CompletionRequest, mode: OutputMode): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user }
      ],
      temperature: 0.2,
      max_completion_tokens: req.maxOutputTokens,
      stream: false
    };
    if (mode === 'json_schema' && req.jsonSchema) {
      body.response_format = { type: 'json_schema', json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: false } };
    } else if (mode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    if (/^openai\/gpt-oss/.test(req.model)) {
      body.reasoning_effort = 'medium';
    }
    try {
      const { data, response } = await client.chat.completions.create(body, { signal: req.signal, timeout: this.options.timeoutMs() }).withResponse();
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) {
        throw new AIError('invalid-response', `Empty response (finish reason: ${data.choices?.[0]?.finish_reason ?? 'unknown'})`);
      }
      return {
        text,
        mode,
        model: data.model ?? req.model,
        usage: data.usage
          ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0, totalTokens: data.usage.total_tokens ?? 0 }
          : undefined,
        rateLimit: {
          remainingRequests: response.headers.get('x-ratelimit-remaining-requests') ?? undefined,
          remainingTokens: response.headers.get('x-ratelimit-remaining-tokens') ?? undefined
        }
      };
    } catch (err) {
      throw mapGroqError(err);
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const client = await this.client();
    try {
      const res = await withRetry(() => client.models.list({ signal }), { maxRetries: Math.min(2, this.options.maxRetries()), signal });
      return res.data.filter((m) => m.active !== false).map((m) => m.id).filter((id) => !/whisper|tts|guard|playai|orpheus/i.test(id)).sort();
    } catch (err) {
      throw mapGroqError(err);
    }
  }

  async testConnection(model: string, signal?: AbortSignal): Promise<{ ok: boolean; message: string; modelAvailable: boolean }> {
    const models = await this.listModels(signal);
    const modelAvailable = models.includes(model);
    return {
      ok: true,
      modelAvailable,
      message: modelAvailable
        ? `Connected to Groq. Model "${model}" is available (${models.length} models listed).`
        : `Connected to Groq, but model "${model}" is not in your available models. Select another model.`
    };
  }
}
