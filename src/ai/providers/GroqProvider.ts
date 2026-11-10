import { AI_PROVIDERS } from '../../models/ai';
import { OpenAICompatibleProvider, type ChatCompletionsClient, type ProviderOptions } from './OpenAICompatibleProvider';
import { mapApiError } from './errorMapping';

export { parseRetryAfter } from './errorMapping';
export const DEFAULT_GROQ_MODEL = AI_PROVIDERS.groq.defaultModel;
/** @deprecated kept for compatibility — use mapApiError. */
export const mapGroqError = mapApiError;
export type GroqLikeClient = ChatCompletionsClient;

export interface GroqProviderOptions extends ProviderOptions {
  /** Injected for tests. */
  clientFactory?: (apiKey: string, timeoutMs: number) => ChatCompletionsClient;
}

export class GroqProvider extends OpenAICompatibleProvider {
  readonly id = 'groq' as const;
  readonly displayName = 'Groq';

  constructor(private readonly groqOptions: GroqProviderOptions) {
    super(groqOptions);
  }

  protected async createClient(apiKey: string, timeoutMs: number): Promise<ChatCompletionsClient> {
    if (this.groqOptions.clientFactory) {
      return this.groqOptions.clientFactory(apiKey, timeoutMs);
    }
    const { default: Groq } = await import('groq-sdk');
    // SDK retries are disabled: retries are handled (and bounded) by withRetry.
    return new Groq({ apiKey, maxRetries: 0, timeout: timeoutMs }) as unknown as ChatCompletionsClient;
  }

  protected tuneBody(model: string, body: Record<string, unknown>): void {
    body.temperature = 0.2;
    if (/^openai\/gpt-oss/.test(model)) {
      body.reasoning_effort = 'medium';
    }
  }

  protected isChatModel(id: string): boolean {
    return !/whisper|tts|guard|playai|orpheus|distil/i.test(id);
  }
}
