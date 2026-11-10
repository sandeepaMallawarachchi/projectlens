import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ApiError } from '@google/genai';
import { OpenAIProvider } from '../../src/ai/providers/OpenAIProvider';
import { GeminiProvider, type GeminiLikeClient } from '../../src/ai/providers/GeminiProvider';
import { AnthropicProvider, type AnthropicLikeClient } from '../../src/ai/providers/AnthropicProvider';
import { createProvider } from '../../src/ai/providers';
import { mapApiError } from '../../src/ai/providers/errorMapping';
import type { ChatCompletionsClient } from '../../src/ai/providers/OpenAICompatibleProvider';
import { AI_PROVIDER_IDS, AI_PROVIDERS } from '../../src/models/ai';

const base = { getApiKey: async () => 'test-key', timeoutMs: () => 1000, maxRetries: () => 2 };
const req = { model: 'm', system: 'sys', user: 'usr', maxOutputTokens: 500, jsonSchema: { name: 'x', schema: { type: 'object' } } };
const headers = (h: Record<string, string> = {}) => new Headers(h);

describe('provider registry', () => {
  it('creates every provider with matching ids and defaults', () => {
    for (const id of AI_PROVIDER_IDS) {
      const p = createProvider(id, base);
      expect(p.id).toBe(id);
      expect(AI_PROVIDERS[id].defaultModel).toBeTruthy();
    }
    expect(AI_PROVIDERS.anthropic.defaultModel).toBe('claude-opus-5-5');
  });

  it('reports a missing key per provider', async () => {
    for (const id of AI_PROVIDER_IDS) {
      await expect(createProvider(id, { ...base, getApiKey: async () => undefined }).complete(req)).rejects.toMatchObject({ kind: 'no-key' });
    }
  });
});

describe('OpenAI provider (mocked)', () => {
  function fake(responses: ((body: Record<string, unknown>) => unknown)[]) {
    const bodies: Record<string, unknown>[] = [];
    const client: ChatCompletionsClient = {
      chat: {
        completions: {
          create(body) {
            bodies.push(body);
            const r = responses[Math.min(bodies.length - 1, responses.length - 1)];
            return {
              withResponse: async () => {
                const out = r(body);
                if (out instanceof Error) {
                  throw out;
                }
                return { data: out as never, response: { headers: headers() } };
              }
            };
          }
        }
      },
      models: { list: async () => ({ data: [{ id: 'gpt-5-mini' }, { id: 'gpt-4o-realtime-preview' }, { id: 'text-embedding-3-small' }, { id: 'o4-mini' }] }) }
    };
    return { client, bodies };
  }
  const ok = (content: string) => ({ model: 'gpt-5-mini', choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });

  it('sends json_schema without temperature and filters chat models', async () => {
    const { client, bodies } = fake([() => ok('{}')]);
    const p = new OpenAIProvider({ ...base, clientFactory: () => client });
    const res = await p.complete(req);
    expect(res.mode).toBe('json_schema');
    expect(bodies[0].temperature).toBeUndefined();
    expect(await p.listModels()).toEqual(['gpt-5-mini', 'o4-mini']);
  });

  it('maps OpenAI SDK errors and model refusals', async () => {
    const err = OpenAI.APIError.generate(401, { error: { message: 'Incorrect API key' } }, undefined, headers());
    expect(mapApiError(err).kind).toBe('auth');
    const { client } = fake([() => ({ choices: [{ message: { content: null, refusal: 'I cannot help with that.' } }] })]);
    await expect(new OpenAIProvider({ ...base, clientFactory: () => client }).complete(req)).rejects.toMatchObject({ kind: 'refused' });
  });
});

describe('Gemini provider (mocked)', () => {
  function fake(gen: (params: { config: Record<string, unknown> }) => unknown) {
    const calls: { model: string; contents: string; config: Record<string, unknown> }[] = [];
    const client: GeminiLikeClient = {
      models: {
        generateContent: async (params) => {
          calls.push(params);
          const out = gen(params);
          if (out instanceof Error) {
            throw out;
          }
          return out as never;
        },
        list: async () =>
          (async function* () {
            yield { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] };
            yield { name: 'models/text-embedding-004', supportedActions: ['embedContent'] };
            yield { name: 'models/gemini-2.5-pro', supportedActions: ['generateContent', 'countTokens'] };
          })()
      }
    };
    return { client, calls };
  }

  it('uses responseJsonSchema with a system instruction and reports usage', async () => {
    const { client, calls } = fake(() => ({ text: '{"ok":true}', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 18 } }));
    const p = new GeminiProvider({ ...base, clientFactory: () => client });
    const res = await p.complete(req);
    expect(res.mode).toBe('json_schema');
    expect(calls[0].config).toMatchObject({ systemInstruction: 'sys', responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } });
    expect(calls[0].config.maxOutputTokens).toBe(8192);
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 8, totalTokens: 18 });
    expect(await p.listModels()).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('treats safety blocks as refusals and maps ApiError statuses', async () => {
    const { client } = fake(() => ({ text: '', candidates: [{ finishReason: 'SAFETY' }] }));
    await expect(new GeminiProvider({ ...base, clientFactory: () => client }).complete(req)).rejects.toMatchObject({ kind: 'refused' });
    expect(mapApiError(new ApiError({ status: 429, message: 'Resource exhausted' })).kind).toBe('rate-limit');
    expect(mapApiError(new ApiError({ status: 400, message: 'API key not valid. Please pass a valid API key.' })).kind).toBe('auth');
  });

  it('falls back to prompt mode when JSON schema output is unsupported', async () => {
    let n = 0;
    const { client, calls } = fake(() => (n++ === 0 ? new ApiError({ status: 400, message: 'responseJsonSchema is not supported for this model' }) : { text: '{}' }));
    const res = await new GeminiProvider({ ...base, clientFactory: () => client }).complete(req);
    expect(res.mode).toBe('json_object');
    expect(calls[1].config.responseJsonSchema).toBeUndefined();
  });
});

describe('Anthropic Claude provider (mocked)', () => {
  function fake(responses: ((body: Record<string, unknown>) => unknown)[]) {
    const bodies: Record<string, unknown>[] = [];
    const client: AnthropicLikeClient = {
      beta: {
        messages: {
          create(body) {
            bodies.push(body);
            const r = responses[Math.min(bodies.length - 1, responses.length - 1)];
            return {
              withResponse: async () => {
                const out = r(body);
                if (out instanceof Error) {
                  throw out;
                }
                return { data: out as never, response: { headers: headers({ 'anthropic-ratelimit-requests-remaining': '42' }) } };
              }
            };
          }
        }
      },
      models: {
        list: () =>
          (async function* () {
            yield { id: 'claude-opus-5-5' };
            yield { id: 'claude-haiku-5-5' };
          })()
      }
    };
    return { client, bodies };
  }
  const msg = (text: string, extra: Record<string, unknown> = {}) => ({
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 40 },
    ...extra
  });

  it('uses output_config JSON schema, refusal fallbacks and a thinking-safe max_tokens', async () => {
    const { client, bodies } = fake([() => msg('{"summary":"x"}')]);
    const p = new AnthropicProvider({ ...base, clientFactory: () => client });
    const res = await p.complete({ ...req, model: 'claude-opus-5-5' });
    expect(res.text).toBe('{"summary":"x"}');
    expect(res.mode).toBe('json_schema');
    expect(res.usage?.totalTokens).toBe(140);
    expect(res.rateLimit?.remainingRequests).toBe('42');
    const body = bodies[0];
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object' } } });
    expect(body.max_tokens).toBe(16000);
    expect(body.system).toBe('sys');
    expect(body.fallbacks).toBe('default');
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(body.temperature).toBeUndefined();
    expect(await p.listModels()).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
  });

  it('omits fallbacks for models that do not support them', async () => {
    const { client, bodies } = fake([() => msg('{}')]);
    await new AnthropicProvider({ ...base, clientFactory: () => client }).complete({ ...req, model: 'claude-haiku-5-5' });
    expect(bodies[0].fallbacks).toBeUndefined();
    expect(bodies[0].betas).toBeUndefined();
  });

  it('surfaces refusals instead of reading content', async () => {
    const { client } = fake([() => msg('', { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] })]);
    await expect(new AnthropicProvider({ ...base, clientFactory: () => client }).complete({ ...req, model: 'claude-opus-5-5' })).rejects.toMatchObject({ kind: 'refused', message: expect.stringContaining('cyber') });
  });

  it('maps Anthropic SDK errors, retries 529 overloads and falls back to prompt mode', async () => {
    expect(mapApiError(Anthropic.APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, undefined, headers())).kind).toBe('auth');
    const rl = mapApiError(Anthropic.APIError.generate(429, { error: { type: 'rate_limit_error', message: 'slow down' } }, undefined, headers({ 'retry-after': '4' })));
    expect(rl).toMatchObject({ kind: 'rate-limit', retryAfterMs: 4000 });
    expect(mapApiError(Anthropic.APIError.generate(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, undefined, headers())).kind).toBe('server');

    const overloaded = Anthropic.APIError.generate(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, undefined, headers({ 'retry-after-ms': '1' }));
    const unsupported = Anthropic.APIError.generate(400, { error: { type: 'invalid_request_error', message: 'output_config.format is not supported for this model' } }, undefined, headers());
    const { client, bodies } = fake([() => overloaded, () => unsupported, () => msg('{}')]);
    const res = await new AnthropicProvider({ ...base, clientFactory: () => client }).complete({ ...req, model: 'claude-legacy' });
    expect(res.mode).toBe('prompt');
    expect(bodies).toHaveLength(3);
    expect(bodies[2].output_config).toBeUndefined();
  });
});
