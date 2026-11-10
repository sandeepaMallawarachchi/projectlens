import { OpenAICompatibleProvider, type ChatCompletionsClient, type ProviderOptions } from './OpenAICompatibleProvider';

export interface OpenAIProviderOptions extends ProviderOptions {
  clientFactory?: (apiKey: string, timeoutMs: number) => ChatCompletionsClient;
}

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly id = 'openai' as const;
  readonly displayName = 'OpenAI';

  constructor(private readonly openaiOptions: OpenAIProviderOptions) {
    super(openaiOptions);
  }

  protected async createClient(apiKey: string, timeoutMs: number): Promise<ChatCompletionsClient> {
    if (this.openaiOptions.clientFactory) {
      return this.openaiOptions.clientFactory(apiKey, timeoutMs);
    }
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey, maxRetries: 0, timeout: timeoutMs }) as unknown as ChatCompletionsClient;
  }

  protected tuneBody(): void {
    // Reasoning models (gpt-5, o-series) reject non-default temperature; keep provider defaults.
  }

  protected isChatModel(id: string): boolean {
    return /^(gpt-|o\d|chatgpt-)/.test(id) && !/audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex/i.test(id);
  }
}
