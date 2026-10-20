/**
 * Failed-unlock throttling.
 *
 * This is a speed bump for attempts made through the app, not a defense
 * against offline guessing — an attacker with the vault bypasses it. The
 * meaningful offline controls are the password policy and PBKDF2 cost.
 *
 * State is per wallet, stored outside the vault (the wallet id and failure
 * count are not secret), and resets on success or after a day of inactivity.
 */
export const UNLOCK_FAILURE_LIMIT = 3;
/** Production cooldown after the third wrong password. Injectable in tests. */
export const DEFAULT_UNLOCK_COOLDOWN_MS = 30_000;

const THROTTLE_KEY_PREFIX = "wallet_unlock_failures_v1:";
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

export interface UnlockThrottle {
  /** Milliseconds the caller must wait, or 0 when an attempt is allowed. */
  retryAfterMs(walletId: string): number;
  recordFailure(walletId: string): void;
  recordSuccess(walletId: string): void;
}

export interface UnlockThrottleOptions {
  readonly cooldownMs?: number;
  readonly now?: () => number;
  /** Defaults to `window.localStorage`; `null` keeps state in memory. */
  readonly storage?: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  > | null;
}

interface ThrottleState {
  /** Failures since the last cooldown or success (0–2). */
  readonly failures: number;
  /** Epoch millis until which attempts are refused; 0 when not blocked. */
  readonly blockedUntil: number;
  readonly updatedAt: number;
}

export class UnlockThrottledError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(
      `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = "UnlockThrottledError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function createUnlockThrottle(
  options: UnlockThrottleOptions = {},
): UnlockThrottle {
  const cooldownMs = options.cooldownMs ?? DEFAULT_UNLOCK_COOLDOWN_MS;
  const now = options.now ?? Date.now;
  const memory = new Map<string, ThrottleState>();
  const inMemoryOnly = options.storage === null;

  function getStorage(): Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  > | null {
    if (inMemoryOnly) return null;
    if (options.storage !== undefined) return options.storage;
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function keyFor(walletId: string): string {
    return `${THROTTLE_KEY_PREFIX}${walletId}`;
  }

  function read(walletId: string): ThrottleState | null {
    const storage = getStorage();
    if (storage === null) return memory.get(walletId) ?? null;

    try {
      const serialized = storage.getItem(keyFor(walletId));
      if (serialized === null) return null;
      return parseState(JSON.parse(serialized));
    } catch {
      return null;
    }
  }

  function write(walletId: string, state: ThrottleState): void {
    memory.set(walletId, state);
    const storage = getStorage();
    if (storage === null) return;
    try {
      storage.setItem(keyFor(walletId), JSON.stringify(state));
    } catch {
      // Storage unavailable: the in-memory copy still throttles this tab.
    }
  }

  function clear(walletId: string): void {
    memory.delete(walletId);
    const storage = getStorage();
    if (storage === null) return;
    try {
      storage.removeItem(keyFor(walletId));
    } catch {
      // Best effort.
    }
  }

  return {
    retryAfterMs(walletId) {
      const state = read(walletId);
      if (state === null) return 0;

      const current = now();
      if (current - state.updatedAt > STATE_TTL_MS) {
        clear(walletId);
        return 0;
      }
      return Math.max(0, state.blockedUntil - current);
    },

    recordFailure(walletId) {
      const current = now();
      let state = read(walletId);

      // A served cooldown or a day-old counter starts a fresh set of attempts.
      if (state !== null) {
        if (current - state.updatedAt > STATE_TTL_MS) state = null;
        else if (state.blockedUntil !== 0 && state.blockedUntil <= current) {
          state = null;
        }
      }

      const failures = (state?.failures ?? 0) + 1;
      if (failures >= UNLOCK_FAILURE_LIMIT) {
        write(walletId, {
          failures: 0,
          blockedUntil: current + cooldownMs,
          updatedAt: current,
        });
        return;
      }
      write(walletId, { failures, blockedUntil: 0, updatedAt: current });
    },

    recordSuccess(walletId) {
      clear(walletId);
    },
  };
}

function parseState(value: unknown): ThrottleState | null {
  if (typeof value !== "object" || value === null) return null;

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.failures !== "number" ||
    !Number.isInteger(candidate.failures) ||
    candidate.failures < 0 ||
    candidate.failures >= UNLOCK_FAILURE_LIMIT ||
    typeof candidate.blockedUntil !== "number" ||
    !Number.isFinite(candidate.blockedUntil) ||
    candidate.blockedUntil < 0 ||
    typeof candidate.updatedAt !== "number" ||
    !Number.isFinite(candidate.updatedAt) ||
    candidate.updatedAt < 0
  ) {
    return null;
  }

  return {
    failures: candidate.failures,
    blockedUntil: candidate.blockedUntil,
    updatedAt: candidate.updatedAt,
  };
}
