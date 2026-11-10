import type { AIProvider, CompletionRequest, CompletionResponse, OutputMode } from '../AIProvider';
import { AIError } from '../errors';
import { withRetry } from '../retry';
import { mapApiError } from './errorMapping';
import { testViaModelList, type ProviderOptions } from './OpenAICompatibleProvider';

/** Minimal surface of the Anthropic SDK used here (tests inject a fake). */
export interface AnthropicLikeClient {
  beta: {
    messages: {
      create(
        body: Record<string, unknown>,
        options?: { signal?: AbortSignal; timeout?: number }
      ): { withResponse(): Promise<{ data: AnthropicMessage; response: { headers: { get(name: string): string | null } } }> };
    };
  };
  models: { list(params?: Record<string, unknown>, options?: { signal?: AbortSignal }): AsyncIterable<{ id: string }> };
}

interface AnthropicMessage {
  model?: string;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicProviderOptions extends ProviderOptions {
  clientFactory?: (apiKey: string, timeoutMs: number) => AnthropicLikeClient;
}

/**
 * Current Claude models think adaptively and thinking tokens count toward max_tokens,
 * so a small configured output budget is raised to leave room for the answer.
 */
const MIN_MAX_TOKENS = 16000;
/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly displayName = 'Anthropic Claude';
  private readonly modeByModel = new Map<string, OutputMode>();

  constructor(private readonly options: AnthropicProviderOptions) {}

  private async client(): Promise<AnthropicLikeClient> {
    const key = await this.options.getApiKey();
    if (!key) {
      throw new AIError('no-key', 'No Anthropic API key configured');
    }
    const timeout = this.options.timeoutMs();
    if (this.options.clientFactory) {
      return this.options.clientFactory(key, timeout);
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    // SDK retries are disabled: retries are handled (and bounded) by withRetry.
    return new Anthropic({ apiKey: key, maxRetries: 0, timeout }) as unknown as AnthropicLikeClient;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const client = await this.client();
    const modes: OutputMode[] = req.jsonSchema ? ['json_schema', 'prompt'] : ['prompt'];
    const known = this.modeByModel.get(req.model);
    const order = known && modes.includes(known) ? modes.slice(modes.indexOf(known)) : modes;
    let lastError: AIError | undefined;
    for (const mode of order) {
      try {
        const res = await withRetry(() => this.send(client, req, mode), { maxRetries: this.options.maxRetries(), signal: req.signal, onRetry: this.options.onRetry });
        this.modeByModel.set(req.model, mode);
        return res;
      } catch (err) {
        const error = mapApiError(err);
        if (mode !== 'prompt' && error.kind === 'unsupported-format') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new AIError('unknown', 'No output mode succeeded');
  }

  private async send(client: AnthropicLikeClient, req: CompletionRequest, mode: OutputMode): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: Math.max(req.maxOutputTokens, MIN_MAX_TOKENS),
      system: req.system,
      messages: [{ role: 'user', content: req.user }]
    };
    if (mode === 'json_schema' && req.jsonSchema) {
      body.output_config = { format: { type: 'json_schema', schema: req.jsonSchema.schema } };
    }
    if (FALLBACK_MODELS.test(req.model)) {
      // On a safety decline, the API re-runs the request on Anthropic's recommended fallback model.
      body.betas = [FALLBACK_BETA];
      body.fallbacks = 'default';
    }
    try {
      const { data, response } = await client.beta.messages.create(body, { signal: req.signal, timeout: this.options.timeoutMs() }).withResponse();
      if (data.stop_reason === 'refusal') {
        const category = data.stop_details?.category;
        throw new AIError('refused', `Claude declined the request${category ? ` (${category})` : ''}.`);
      }
      const text = data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      if (!text.trim()) {
        throw new AIError('invalid-response', `Empty response (stop reason: ${data.stop_reason ?? 'unknown'})`);
      }
      const input = data.usage?.input_tokens ?? 0;
      const output = data.usage?.output_tokens ?? 0;
      return {
        text,
        mode,
        model: data.model ?? req.model,
        usage: data.usage ? { promptTokens: input, completionTokens: output, totalTokens: input + output } : undefined,
        rateLimit: {
          remainingRequests: response.headers.get('anthropic-ratelimit-requests-remaining') ?? undefined,
          remainingTokens: response.headers.get('anthropic-ratelimit-tokens-remaining') ?? undefined
        }
      };
    } catch (err) {
      throw mapApiError(err);
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const client = await this.client();
    try {
      return await withRetry(
        async () => {
          const ids: string[] = [];
          for await (const m of client.models.list({ limit: 100 }, { signal })) {
            ids.push(m.id);
          }
          return ids.sort();
        },
        { maxRetries: Math.min(2, this.options.maxRetries()), signal }
      );
    } catch (err) {
      throw mapApiError(err);
    }
  }

  testConnection(model: string, signal?: AbortSignal) {
    return testViaModelList(this, model, signal);
  }
}
