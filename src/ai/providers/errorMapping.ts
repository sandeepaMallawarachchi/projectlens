import { AIError } from '../errors';

interface HeadersLike {
  get?(name: string): string | null | undefined;
  [key: string]: unknown;
}

export function header(headers: unknown, name: string): string | undefined {
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

/**
 * Maps SDK errors from any provider to AIError. Groq, OpenAI and Anthropic SDKs share the
 * Stainless error shape (`status`, `headers`, `error`, class names); Gemini's ApiError has `status`.
 */
export function mapApiError(err: unknown): AIError {
  if (err instanceof AIError) {
    return err;
  }
  const e = err as {
    name?: string;
    constructor?: { name?: string };
    status?: number;
    message?: string;
    headers?: unknown;
    error?: { error?: { message?: string; code?: string; type?: string }; message?: string; code?: string; type?: string };
  };
  const name = `${e?.name ?? ''} ${e?.constructor?.name ?? ''}`;
  const apiMessage = e?.error?.error?.message ?? e?.error?.message ?? e?.message ?? 'Unknown error';
  const code = `${e?.error?.error?.code ?? e?.error?.code ?? ''} ${e?.error?.error?.type ?? e?.error?.type ?? ''}`;
  if (/APIUserAbortError|AbortError/.test(name)) {
    return new AIError('cancelled', 'Request cancelled', { cause: err });
  }
  if (/APIConnectionTimeoutError|TimeoutError/.test(name)) {
    return new AIError('timeout', 'Request timed out', { cause: err });
  }
  if (/APIConnectionError/.test(name) || (typeof e?.status !== 'number' && /fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network/i.test(apiMessage))) {
    return new AIError('network', apiMessage, { cause: err });
  }
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status === undefined) {
    return new AIError('unknown', apiMessage, { cause: err });
  }
  const opts = { status, cause: err, retryAfterMs: parseRetryAfter(e.headers) };
  const all = `${code} ${apiMessage}`;
  if (status === 401 || (status === 400 && /api[_ ]key.*(invalid|not valid)|API_KEY_INVALID/i.test(all))) {
    return new AIError('auth', apiMessage, opts);
  }
  if (status === 403) {
    return new AIError('forbidden', apiMessage, opts);
  }
  if (status === 404 || /model_not_found|model_decommissioned|does not exist|is not found for API version/i.test(all)) {
    return new AIError('model', apiMessage, opts);
  }
  if (status === 413 || /context_length|too large|maximum context|prompt is too long/i.test(apiMessage)) {
    return new AIError('too-large', apiMessage, opts);
  }
  if (status === 429) {
    return new AIError('rate-limit', apiMessage, opts);
  }
  if (status === 498 || status === 529 || status >= 500) {
    return new AIError('server', apiMessage, opts);
  }
  if (status === 400 && /json_validate_failed/.test(all)) {
    return new AIError('invalid-response', apiMessage, opts);
  }
  if (status === 400 && /response_format|json_schema|json_object|structured output|output_config|output format|responseJsonSchema|response_mime_type|does not support/i.test(apiMessage)) {
    return new AIError('unsupported-format', apiMessage, opts);
  }
  return new AIError('bad-request', apiMessage, opts);
}
