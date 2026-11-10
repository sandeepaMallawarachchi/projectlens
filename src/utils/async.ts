export class CancelledError extends Error {
  constructor(message = 'Operation cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancelledError();
  }
}

/** Yields to the event loop so long scans never monopolize the extension host. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Minimal semaphore used to bound concurrent work (e.g. AI requests). */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  get pending(): number {
    return this.queue.length + this.active;
  }
}
