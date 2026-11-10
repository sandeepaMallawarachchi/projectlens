import type { AIProviderId } from '../../models/ai';
import type { AIProvider } from '../AIProvider';
import type { ProviderOptions } from './OpenAICompatibleProvider';
import { GroqProvider } from './GroqProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';
import { AnthropicProvider } from './AnthropicProvider';

/** Creates the provider implementation for an id. Each call is cheap; clients are built per request. */
export function createProvider(id: AIProviderId, options: ProviderOptions): AIProvider {
  switch (id) {
    case 'groq':
      return new GroqProvider(options);
    case 'openai':
      return new OpenAIProvider(options);
    case 'gemini':
      return new GeminiProvider(options);
    case 'anthropic':
      return new AnthropicProvider(options);
  }
}
