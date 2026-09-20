import type { Clock } from "./clock";

export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
};

export function backoffDelayMs(attempt: number, policy: RetryPolicy, random: () => number): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

export type RetryOptions = {
  policy: RetryPolicy;
  clock: Clock;
  random: () => number;
  retryable: (error: unknown) => boolean;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
};

export async function withRetry<T>(
  run: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, options.policy.maxAttempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !options.retryable(error)) throw error;
      const delayMs = backoffDelayMs(attempt, options.policy, options.random);
      options.onRetry?.(attempt, delayMs, error);
      await options.clock.sleep(delayMs);
    }
  }
  throw lastError;
}
