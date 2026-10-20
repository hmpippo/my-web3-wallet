/**
 * Idle-session controller.
 *
 * Kept free of React so the timing rules are unit-testable. The deadline is an
 * absolute timestamp: activity resets it, and `check()` can be called when the
 * tab becomes visible again because background timers are throttled and a
 * sleeping device may not fire them on time.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export interface IdleLockOptions {
  readonly timeoutMs?: number;
  readonly isActive: () => boolean;
  readonly onIdle: () => void;
  readonly now?: () => number;
}

export interface IdleLock {
  /** Arms the timer. Call when a wallet session starts. */
  start(): void;
  /** Disarms the timer. Call when the wallet locks or unmounts. */
  stop(): void;
  /** Resets the countdown after real user input. */
  noteActivity(): void;
  /** Locks immediately if the deadline elapsed while timers were suspended. */
  check(): void;
}

export function createIdleLock(options: IdleLockOptions): IdleLock {
  const timeoutMs = options.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  let deadline: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function disarm(): void {
    clearTimer();
    deadline = null;
  }

  function fire(): void {
    timer = null;
    if (deadline === null) return;

    const remaining = deadline - now();
    if (remaining > 0) {
      // A clock adjustment or an early timer: keep waiting for the deadline.
      timer = setTimeout(fire, remaining);
      return;
    }

    const active = options.isActive();
    disarm();
    if (active) options.onIdle();
  }

  function arm(): void {
    clearTimer();
    if (!options.isActive()) {
      deadline = null;
      return;
    }
    deadline = now() + timeoutMs;
    timer = setTimeout(fire, timeoutMs);
  }

  return {
    start: arm,
    stop: disarm,
    noteActivity() {
      if (options.isActive()) arm();
    },
    check() {
      if (!options.isActive()) {
        disarm();
        return;
      }
      if (deadline === null || now() < deadline) return;
      disarm();
      options.onIdle();
    },
  };
}
