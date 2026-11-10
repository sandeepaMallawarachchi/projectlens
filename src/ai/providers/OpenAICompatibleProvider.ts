import type { AIProviderId } from '../../models/ai';
import type { AIProvider, CompletionRequest, CompletionResponse, OutputMode } from '../AIProvider';
import { AIError } from '../errors';
import { withRetry } from '../retry';
import { mapApiError } from './errorMapping';

/** Common provider options: credentials and limits are read lazily so settings changes apply immediately. */
export interface ProviderOptions {
  getApiKey: () => Promise<string | undefined>;
  timeoutMs: () => number;
  maxRetries: () => number;
  onRetry?: (attempt: number, delayMs: number, error: AIError) => void;
}

/** The subset of the Groq/OpenAI SDK used here (lets tests inject a fake). */
export interface ChatCompletionsClient {
  chat: {
    completions: {
      create(body: Record<string, unknown>, options?: { signal?: AbortSignal; timeout?: number }): {
        withResponse(): Promise<{ data: ChatCompletion; response: { headers: { get(name: string): string | null } } }>;
      };
    };
  };
  models: { list(options?: { signal?: AbortSignal }): Promise<{ data: { id: string; active?: boolean }[] }> };
}

interface ChatCompletion {
  model?: string;
  choices: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Shared implementation for OpenAI Chat Completions-compatible providers (Groq, OpenAI).
 * Output modes are tried in order json_schema → json_object → prompt; the working mode is
 * remembered per model so unsupported modes are not retried on every request.
 */
export abstract class OpenAICompatibleProvider implements AIProvider {
  abstract readonly id: AIProviderId;
  abstract readonly displayName: string;
  private readonly modeByModel = new Map<string, OutputMode>();

  constructor(protected readonly options: ProviderOptions) {}

  /** SDKs are imported lazily so they are only loaded when the provider is used. */
  protected abstract createClient(apiKey: string, timeoutMs: number): Promise<ChatCompletionsClient>;
  /** Provider/model-specific body adjustments (sampling, reasoning effort). */
  protected abstract tuneBody(model: string, body: Record<string, unknown>): void;
  /** Filters `models.list()` to chat-capable models. */
  protected abstract isChatModel(id: string): boolean;

  private async client(): Promise<ChatCompletionsClient> {
    const key = await this.options.getApiKey();
    if (!key) {
      throw new AIError('no-key', `No ${this.displayName} API key configured`);
    }
    return await this.createClient(key, this.options.timeoutMs());
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const client = await this.client();
    const modes: OutputMode[] = req.jsonSchema ? ['json_schema', 'json_object', 'prompt'] : ['json_object', 'prompt'];
    const known = this.modeByModel.get(req.model);
    const order = known && modes.includes(known) ? modes.slice(modes.indexOf(known)) : modes;
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
        const error = mapApiError(err);
        // Fall back to a less strict output mode only for format-related rejections.
        if (mode !== 'prompt' && (error.kind === 'unsupported-format' || error.kind === 'invalid-response')) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new AIError('unknown', 'No output mode succeeded');
  }

  private async send(client: ChatCompletionsClient, req: CompletionRequest, mode: OutputMode): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user }
      ],
      max_completion_tokens: req.maxOutputTokens,
      stream: false
    };
    if (mode === 'json_schema' && req.jsonSchema) {
      body.response_format = { type: 'json_schema', json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: false } };
    } else if (mode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    this.tuneBody(req.model, body);
    try {
      const { data, response } = await client.chat.completions.create(body, { signal: req.signal, timeout: this.options.timeoutMs() }).withResponse();
      const choice = data.choices?.[0];
      if (choice?.message?.refusal) {
        throw new AIError('refused', choice.message.refusal);
      }
      const text = choice?.message?.content ?? '';
      if (!text.trim()) {
        throw new AIError('invalid-response', `Empty response (finish reason: ${choice?.finish_reason ?? 'unknown'})`);
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
      throw mapApiError(err);
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const client = await this.client();
    try {
      const res = await withRetry(() => client.models.list({ signal }), { maxRetries: Math.min(2, this.options.maxRetries()), signal });
      return res.data.filter((m) => m.active !== false && this.isChatModel(m.id)).map((m) => m.id).sort();
    } catch (err) {
      throw mapApiError(err);
    }
  }

  async testConnection(model: string, signal?: AbortSignal) {
    return testViaModelList(this, model, signal);
  }
}

/** Shared connection test: listing models verifies the key without spending tokens. */
export async function testViaModelList(provider: AIProvider, model: string, signal?: AbortSignal): Promise<{ ok: boolean; message: string; modelAvailable: boolean }> {
  const models = await provider.listModels(signal);
  const modelAvailable = models.includes(model);
  return {
    ok: true,
    modelAvailable,
    message: modelAvailable
      ? `Connected to ${provider.displayName}. Model "${model}" is available (${models.length} models listed).`
      : `Connected to ${provider.displayName}, but model "${model}" is not in your available models. Select another model.`
  };
}
