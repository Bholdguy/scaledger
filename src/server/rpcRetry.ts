/**
 * Exponential backoff with jitter on rate-limit errors, capped at 5 retries.
 * See SECURITY.md Section 3. A call that exhausts retries throws — callers must
 * surface an explicit error, never a silently-empty result (SECURITY.md Section 3:
 * "never a silent empty result that could be misread as 'no rebase found'").
 */
export class RpcRateLimitError extends Error {
  constructor(cause: unknown) {
    super('Solana RPC call failed after exhausting retries (rate limited)');
    this.name = 'RpcRateLimitError';
    this.cause = cause;
  }
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof RpcCallTimeoutError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('429') || msg.toLowerCase().includes('too many requests');
}

class RpcCallTimeoutError extends Error {
  constructor() {
    super('Solana RPC call exceeded its per-call timeout');
    this.name = 'RpcCallTimeoutError';
  }
}

function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RpcCallTimeoutError()), timeoutMs);
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    maxRetries = 5,
    baseDelayMs = 300,
    timeoutMs = 15_000,
  }: { maxRetries?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err) || attempt === maxRetries) {
        break;
      }
      const jitter = Math.random() * baseDelayMs;
      const delay = baseDelayMs * 2 ** attempt + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  if (isRateLimitError(lastErr)) {
    throw new RpcRateLimitError(lastErr);
  }
  throw lastErr;
}
