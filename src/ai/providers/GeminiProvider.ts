import type { AIProvider, CompletionRequest, CompletionResponse, OutputMode } from '../AIProvider';
import { AIError } from '../errors';
import { withRetry } from '../retry';
import { mapApiError } from './errorMapping';
import { testViaModelList, type ProviderOptions } from './OpenAICompatibleProvider';

/** Minimal surface of the @google/genai client used here (tests inject a fake). */
export interface GeminiLikeClient {
  models: {
    generateContent(params: { model: string; contents: string; config: Record<string, unknown> }): Promise<{
      text?: string;
      modelVersion?: string;
      candidates?: { finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; thoughtsTokenCount?: number };
    }>;
    list(params?: Record<string, unknown>): Promise<AsyncIterable<{ name?: string; supportedActions?: string[] }>>;
  };
}

export interface GeminiProviderOptions extends ProviderOptions {
  clientFactory?: (apiKey: string, timeoutMs: number) => GeminiLikeClient;
}

/** Thinking tokens count toward Gemini's output budget, so keep room for the answer. */
const MIN_OUTPUT_TOKENS = 8192;

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly displayName = 'Google Gemini';
  private readonly modeByModel = new Map<string, OutputMode>();

  constructor(private readonly options: GeminiProviderOptions) {}

  private async client(): Promise<GeminiLikeClient> {
    const key = await this.options.getApiKey();
    if (!key) {
      throw new AIError('no-key', 'No Google Gemini API key configured');
    }
    const timeout = this.options.timeoutMs();
    if (this.options.clientFactory) {
      return this.options.clientFactory(key, timeout);
    }
    const { GoogleGenAI } = await import('@google/genai');
    return new GoogleGenAI({ apiKey: key, httpOptions: { timeout } }) as unknown as GeminiLikeClient;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const client = await this.client();
    const modes: OutputMode[] = req.jsonSchema ? ['json_schema', 'json_object', 'prompt'] : ['json_object', 'prompt'];
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

  private async send(client: GeminiLikeClient, req: CompletionRequest, mode: OutputMode): Promise<CompletionResponse> {
    const config: Record<string, unknown> = {
      systemInstruction: req.system,
      maxOutputTokens: Math.max(req.maxOutputTokens, MIN_OUTPUT_TOKENS),
      abortSignal: req.signal,
      httpOptions: { timeout: this.options.timeoutMs() }
    };
    if (mode !== 'prompt') {
      config.responseMimeType = 'application/json';
    }
    if (mode === 'json_schema' && req.jsonSchema) {
      config.responseJsonSchema = req.jsonSchema.schema;
    }
    try {
      const res = await client.models.generateContent({ model: req.model, contents: req.user, config });
      const finish = res.candidates?.[0]?.finishReason;
      if (res.promptFeedback?.blockReason || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST') {
        throw new AIError('refused', `Gemini blocked the request (${res.promptFeedback?.blockReason ?? finish}).`);
      }
      const text = res.text ?? '';
      if (!text.trim()) {
        throw new AIError('invalid-response', `Empty response (finish reason: ${finish ?? 'unknown'})`);
      }
      const u = res.usageMetadata;
      return {
        text,
        mode,
        model: res.modelVersion ?? req.model,
        usage: u ? { promptTokens: u.promptTokenCount ?? 0, completionTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), totalTokens: u.totalTokenCount ?? 0 } : undefined
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
          const pager = await client.models.list({ config: { pageSize: 100, abortSignal: signal } });
          for await (const m of pager) {
            const id = (m.name ?? '').replace(/^models\//, '');
            if (id && (m.supportedActions ?? ['generateContent']).includes('generateContent') && !/embedding|imagen|veo|tts|aqa|image|audio|live/i.test(id)) {
              ids.push(id);
            }
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
