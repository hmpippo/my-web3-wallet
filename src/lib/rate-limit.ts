/**
 * Small fixed-window rate limiter.
 *
 * Kept framework-free so the route can use it without pulling a dependency
 * into the client bundle, and so the window logic is testable with a fake
 * clock. State is per process: on a multi-instance deployment (for example
 * Vercel) each instance enforces its own share of the limit.
 */
export interface RateLimitResult {
  readonly allowed: boolean;
  /** Milliseconds until the current window resets; 0 when allowed. */
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitResult;
  reset(): void;
}

export interface RateLimitOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
  /** Prune expired buckets once the map grows past this size. */
  readonly maxKeys?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new RangeError("Rate limit must be a positive integer");
  }
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new RangeError("Rate limit window must be positive");
  }

  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const buckets = new Map<string, Bucket>();

  function prune(current: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) buckets.delete(key);
    }
  }

  return {
    consume(key: string): RateLimitResult {
      const current = now();
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= current) {
        if (buckets.size >= maxKeys) prune(current);
        buckets.set(key, {
          count: 1,
          resetAt: current + options.windowMs,
        });
        return { allowed: true, retryAfterMs: 0 };
      }

      if (bucket.count >= options.limit) {
        return { allowed: false, retryAfterMs: bucket.resetAt - current };
      }

      bucket.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    },

    reset(): void {
      buckets.clear();
    },
  };
}
