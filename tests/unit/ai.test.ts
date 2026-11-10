import { describe, expect, it, vi } from 'vitest';
import Groq from 'groq-sdk';
import { extractJson, parseAnalysis } from '../../src/ai/responseParser';
import { AIError, describeAIError } from '../../src/ai/errors';
import { backoffDelay, withRetry } from '../../src/ai/retry';
import { GroqProvider, mapGroqError, parseRetryAfter, type GroqLikeClient } from '../../src/ai/providers/GroqProvider';
import { AIService, mergeAnalyses } from '../../src/ai/aiService';
import { scanFixture } from './helpers';

const VALID = {
  summary: 'The project is a small Express API.',
  observations: [{ title: 'SQL built from input', detail: 'Uses template literals.', category: 'security', severity: 'high', confidence: 'high', fileReferences: [{ path: 'src/routes/users.js', line: 11 }, { path: 'invented/file.ts', line: 3 }] }],
  recommendations: [{ title: 'Parameterize queries', detail: 'Use placeholders.', priority: 'high', effort: 'small', severity: 'high', confidence: 'medium', fileReferences: [] }],
  overallSeverity: 'high',
  overallConfidence: 'medium'
};

describe('AI response validation', () => {
  it('accepts valid JSON and drops file references without evidence', () => {
    const { analysis, droppedReferences } = parseAnalysis(JSON.stringify(VALID), new Set(['src/routes/users.js']));
    expect(analysis.observations[0].fileReferences).toEqual([{ path: 'src/routes/users.js', line: 11 }]);
    expect(droppedReferences).toBe(1);
  });

  it('extracts JSON from code fences and surrounding prose', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"a":2} suffix')).toEqual({ a: 2 });
  });

  it('rejects malformed and schema-invalid output', () => {
    expect(() => parseAnalysis('not json at all', new Set())).toThrow(AIError);
    expect(() => parseAnalysis(JSON.stringify({ summary: '' }), new Set())).toThrow(/Schema validation failed/);
    expect(() => parseAnalysis(JSON.stringify({ ...VALID, observations: 'nope' }), new Set())).toThrow(/Schema validation failed/);
  });

  it('coerces unknown enum values to safe defaults', () => {
    const { analysis } = parseAnalysis(JSON.stringify({ ...VALID, overallSeverity: 'catastrophic', observations: [{ ...VALID.observations[0], confidence: 'certain' }] }), new Set());
    expect(analysis.overallSeverity).toBe('info');
    expect(analysis.observations[0].confidence).toBe('low');
  });

  it('merges batched analyses', () => {
    const a = parseAnalysis(JSON.stringify(VALID), new Set()).analysis;
    const merged = mergeAnalyses([a, { ...a, overallSeverity: 'critical', overallConfidence: 'low' }]);
    expect(merged.observations).toHaveLength(1);
    expect(merged.overallSeverity).toBe('critical');
    expect(merged.overallConfidence).toBe('low');
  });
});

describe('Groq error handling', () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it('maps HTTP statuses to error kinds', () => {
    expect(mapGroqError(Groq.APIError.generate(401, { error: { message: 'Invalid API Key' } }, undefined, headers({}))).kind).toBe('auth');
    expect(mapGroqError(Groq.APIError.generate(403, { error: { message: 'forbidden' } }, undefined, headers({}))).kind).toBe('forbidden');
    const rl = mapGroqError(Groq.APIError.generate(429, { error: { message: 'Rate limit' } }, undefined, headers({ 'retry-after': '7' })));
    expect(rl.kind).toBe('rate-limit');
    expect(rl.retryAfterMs).toBe(7000);
    expect(rl.retryable).toBe(true);
    expect(mapGroqError(Groq.APIError.generate(503, { error: { message: 'down' } }, undefined, headers({}))).kind).toBe('server');
    expect(mapGroqError(Groq.APIError.generate(404, { error: { message: 'The model `x` does not exist', code: 'model_not_found' } }, undefined, headers({}))).kind).toBe('model');
    expect(mapGroqError(Groq.APIError.generate(400, { error: { message: 'response_format json_schema is not supported' } }, undefined, headers({}))).kind).toBe('unsupported-format');
    expect(mapGroqError(new Groq.APIConnectionTimeoutError()).kind).toBe('timeout');
    expect(mapGroqError(new Groq.APIUserAbortError()).kind).toBe('cancelled');
    expect(mapGroqError(new Groq.APIConnectionError({ message: 'ECONNRESET' })).kind).toBe('network');
    expect(new AIError('auth', 'x').retryable).toBe(false);
  });

  it('parses Retry-After headers', () => {
    expect(parseRetryAfter(headers({ 'retry-after': '2' }))).toBe(2000);
    expect(parseRetryAfter(headers({ 'retry-after-ms': '150' }))).toBe(150);
    expect(parseRetryAfter({ 'retry-after': '3' })).toBe(3000);
    expect(parseRetryAfter(headers({}))).toBeUndefined();
  });

  it('provides actionable messages', () => {
    expect(describeAIError(new AIError('auth', 'x'))).toMatch(/401/);
    expect(describeAIError(new AIError('rate-limit', 'x', { retryAfterMs: 3000 }))).toMatch(/3 s/);
    expect(describeAIError(new AIError('network', 'x'))).toMatch(/offline/);
  });
});

describe('retry with backoff', () => {
  it('retries temporary errors and respects Retry-After', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) {
          throw new AIError('rate-limit', 'slow down', { retryAfterMs: 20 });
        }
        if (calls === 2) {
          throw new AIError('server', 'oops', { status: 502 });
        }
        return 'ok';
      },
      { maxRetries: 3, baseDelayMs: 5, onRetry: (_a, d) => delays.push(d), random: () => 0 }
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(delays).toEqual([250, 10]);
  });

  it('does not retry auth errors and stops after maxRetries', async () => {
    const fn = vi.fn(async () => {
      throw new AIError('auth', 'bad key', { status: 401 });
    });
    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toMatchObject({ kind: 'auth' });
    expect(fn).toHaveBeenCalledTimes(1);
    const always = vi.fn(async () => {
      throw new AIError('server', 'down', { status: 500 });
    });
    await expect(withRetry(always, { maxRetries: 2, baseDelayMs: 1 })).rejects.toMatchObject({ kind: 'server' });
    expect(always).toHaveBeenCalledTimes(3);
  });

  it('gives up immediately when Retry-After is too long', async () => {
    const fn = vi.fn(async () => {
      throw new AIError('rate-limit', 'wait', { retryAfterMs: 10 * 60_000 });
    });
    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is cancellable', async () => {
    const controller = new AbortController();
    const p = withRetry(
      async () => {
        throw new AIError('server', 'x');
      },
      { maxRetries: 5, baseDelayMs: 10_000, signal: controller.signal }
    );
    setTimeout(() => controller.abort(), 10);
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('caps exponential backoff', () => {
    expect(backoffDelay(0, 1000, 30_000, () => 0)).toBe(1000);
    expect(backoffDelay(3, 1000, 30_000, () => 0)).toBe(8000);
    expect(backoffDelay(10, 1000, 30_000, () => 0)).toBe(30_000);
  });
});

type Responder = (body: Record<string, unknown>) => unknown;

function fakeClient(responders: Responder[], models = ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile']) {
  const bodies: Record<string, unknown>[] = [];
  const client: GroqLikeClient = {
    chat: {
      completions: {
        create(body) {
          bodies.push(body);
          const responder = responders[Math.min(bodies.length - 1, responders.length - 1)];
          return {
            withResponse: async () => {
              const out = responder(body);
              if (out instanceof Error) {
                throw out;
              }
              return { data: out as never, response: { headers: new Headers({ 'x-ratelimit-remaining-requests': '99' }) } };
            }
          };
        }
      }
    },
    models: { list: async () => ({ data: models.map((id) => ({ id, active: true })) }) }
  };
  return { client, bodies };
}

const completion = (content: string) => ({ model: 'openai/gpt-oss-20b', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });

function provider(client: GroqLikeClient, key: string | null = 'test-key', maxRetries = 2) {
  return new GroqProvider({ getApiKey: async () => key ?? undefined, timeoutMs: () => 1000, maxRetries: () => maxRetries, clientFactory: () => client });
}

const req = { model: 'openai/gpt-oss-20b', system: 's', user: 'u', maxOutputTokens: 100, jsonSchema: { name: 'x', schema: {} } };

describe('GroqProvider (mocked API)', () => {
  it('uses structured JSON schema output first and reports usage', async () => {
    const { client, bodies } = fakeClient([() => completion('{"ok":true}')]);
    const res = await provider(client).complete(req);
    expect(res.mode).toBe('json_schema');
    expect((bodies[0].response_format as { type: string }).type).toBe('json_schema');
    expect(res.usage?.totalTokens).toBe(150);
    expect(res.rateLimit?.remainingRequests).toBe('99');
  });

  it('falls back to json_object when json_schema is unsupported', async () => {
    const { client, bodies } = fakeClient([
      () => Groq.APIError.generate(400, { error: { message: 'response_format `json_schema` is not supported by this model' } }, undefined, new Headers()),
      () => completion('{"ok":true}')
    ]);
    const p = provider(client);
    const res = await p.complete(req);
    expect(res.mode).toBe('json_object');
    expect(bodies).toHaveLength(2);
    await p.complete(req);
    expect((bodies[2].response_format as { type: string }).type).toBe('json_object');
  });

  it('retries 429 responses and then succeeds', async () => {
    const { client, bodies } = fakeClient([() => Groq.APIError.generate(429, { error: { message: 'rate' } }, undefined, new Headers({ 'retry-after-ms': '1' })), () => completion('{}')]);
    const res = await provider(client).complete(req);
    expect(res.text).toBe('{}');
    expect(bodies).toHaveLength(2);
  });

  it('fails fast on 401 without retrying', async () => {
    const { client, bodies } = fakeClient([() => Groq.APIError.generate(401, { error: { message: 'Invalid API Key' } }, undefined, new Headers())]);
    await expect(provider(client).complete(req)).rejects.toMatchObject({ kind: 'auth' });
    expect(bodies).toHaveLength(1);
  });

  it('bounds retries on persistent 5xx errors', async () => {
    const { client, bodies } = fakeClient([() => Groq.APIError.generate(500, { error: { message: 'down' } }, undefined, new Headers({ 'retry-after-ms': '1' }))]);
    await expect(provider(client, 'k', 2).complete(req)).rejects.toMatchObject({ kind: 'server' });
    expect(bodies).toHaveLength(3);
  });

  it('requires an API key', async () => {
    const { client } = fakeClient([() => completion('{}')]);
    await expect(provider(client, null).complete(req)).rejects.toMatchObject({ kind: 'no-key' });
  });

  it('tests the connection and model availability', async () => {
    const { client } = fakeClient([], ['llama-3.3-70b-versatile', 'whisper-large-v3']);
    const res = await provider(client).testConnection('openai/gpt-oss-20b');
    expect(res.ok).toBe(true);
    expect(res.modelAvailable).toBe(false);
    expect(await provider(client).listModels()).toEqual(['llama-3.3-70b-versatile']);
  });
});

describe('AIService', () => {
  const settings = () => ({ model: 'openai/gpt-oss-20b', maxContextTokens: 4000, maxOutputTokens: 500, maxRequestsPerSession: 2, maxConcurrentRequests: 1 });

  it('sends nothing when consent is declined', async () => {
    const scan = await scanFixture('vulnerable-app');
    const { client, bodies } = fakeClient([() => completion(JSON.stringify(VALID))]);
    const service = new AIService({ provider: provider(client), settings, readFile: async () => 'const a = 1;', consent: async () => false });
    await expect(service.run({ task: 'architectureSummary', scan })).rejects.toMatchObject({ kind: 'consent-declined' });
    expect(bodies).toHaveLength(0);
  });

  it('runs an approved request, validates output and enforces the session limit', async () => {
    const scan = await scanFixture('vulnerable-app');
    const { client, bodies } = fakeClient([() => completion(JSON.stringify(VALID))]);
    const consent = vi.fn(async () => true);
    const service = new AIService({ provider: provider(client), settings, readFile: async () => 'const a = 1;', consent });
    const insight = await service.run({ task: 'securityConcerns', scan });
    expect(insight.analysis.summary).toBe(VALID.summary);
    expect(insight.usage?.totalTokens).toBe(150);
    expect(consent).toHaveBeenCalledTimes(1);
    const preview = (consent.mock.calls[0] as unknown as [{ payload: string }])[0];
    expect(preview.payload).not.toContain('Wk3Rm9Tq2LxZ');
    expect(JSON.stringify(bodies)).not.toContain('Qz8vT2mLx9Rk4Wp7');
    expect(insight.fileUris['src/routes/users.js']).toMatch(/^file:/);
    await service.run({ task: 'improvements', scan });
    await expect(service.run({ task: 'improvements', scan })).rejects.toMatchObject({ kind: 'limit' });
  });

  it('rejects malformed AI output safely', async () => {
    const scan = await scanFixture('healthy-nextjs');
    const { client } = fakeClient([() => completion('I cannot produce JSON today')]);
    const service = new AIService({ provider: provider(client), settings, readFile: async () => '', consent: async () => true });
    await expect(service.run({ task: 'architectureSummary', scan })).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});
