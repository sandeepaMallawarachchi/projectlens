import type { AIProviderId, AIUsage } from '../models/ai';

export type OutputMode = 'json_schema' | 'json_object' | 'prompt';

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  /** JSON Schema for structured outputs (used when the model supports it). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  signal?: AbortSignal;
}

export interface CompletionResponse {
  text: string;
  mode: OutputMode;
  usage?: AIUsage;
  rateLimit?: { remainingRequests?: string; remainingTokens?: string };
  model: string;
}

/** Provider abstraction implemented by Groq, OpenAI, Gemini and Anthropic. */
export interface AIProvider {
  readonly id: AIProviderId;
  readonly displayName: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  listModels(signal?: AbortSignal): Promise<string[]>;
  testConnection(model: string, signal?: AbortSignal): Promise<{ ok: boolean; message: string; modelAvailable: boolean }>;
}
