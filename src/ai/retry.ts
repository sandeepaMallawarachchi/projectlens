import { AIError } from './errors';
import { sleep, CancelledError } from '../utils/async';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Retry-After values above this are not waited for. */
  maxRetryAfterMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: AIError) => void;
  random?: () => number;
}

export function backoffDelay(attempt: number, base: number, max: number, random: () => number = Math.random): number {
  const exp = base * 2 ** attempt;
  const jitter = exp * 0.2 * random();
  return Math.min(max, Math.round(exp + jitter));
}

/** Retries temporary failures with exponential backoff, honoring Retry-After. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 30_000;
  const maxRetryAfter = opts.maxRetryAfterMs ?? 60_000;
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) {
      throw new AIError('cancelled', 'Request cancelled');
    }
    try {
      return await fn(attempt);
    } catch (err) {
      const error = err instanceof AIError ? err : new AIError('unknown', err instanceof Error ? err.message : String(err), { cause: err });
      if (!error.retryable || attempt >= opts.maxRetries) {
        throw error;
      }
      if (error.retryAfterMs !== undefined && error.retryAfterMs > maxRetryAfter) {
        throw error;
      }
      const delay = error.retryAfterMs !== undefined ? Math.max(error.retryAfterMs, 250) : backoffDelay(attempt, base, max, opts.random);
      opts.onRetry?.(attempt + 1, delay, error);
      try {
        await sleep(delay, opts.signal);
      } catch (e) {
        if (e instanceof CancelledError) {
          throw new AIError('cancelled', 'Request cancelled');
        }
        throw e;
      }
    }
  }
}
