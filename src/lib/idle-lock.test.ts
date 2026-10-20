import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdleLock, DEFAULT_IDLE_TIMEOUT_MS } from "./idle-lock";

describe("idle lock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(active = true) {
    let unlocked = active;
    const onIdle = vi.fn(() => {
      // Mirrors the service: locking ends the session.
      unlocked = false;
    });
    const idle = createIdleLock({
      timeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      isActive: () => unlocked,
      onIdle,
    });
    return {
      idle,
      onIdle,
      setActive(value: boolean) {
        unlocked = value;
      },
    };
  }

  it("locks after exactly 30 seconds without input", () => {
    const { idle, onIdle } = setup();
    idle.start();

    vi.advanceTimersByTime(29_999);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("restarts the countdown on activity", () => {
    const { idle, onIdle } = setup();
    idle.start();

    vi.advanceTimersByTime(20_000);
    idle.noteActivity();
    vi.advanceTimersByTime(20_000);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("locks on check when the deadline passed while suspended", () => {
    const { idle, onIdle } = setup();
    idle.start();

    // The tab was frozen: wall-clock time moved, timers did not.
    vi.setSystemTime(40_000);
    expect(onIdle).not.toHaveBeenCalled();

    idle.check();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does not restart a session that is already expired", () => {
    const { idle, onIdle } = setup();
    idle.start();

    vi.setSystemTime(40_000);
    idle.check();
    expect(onIdle).toHaveBeenCalledTimes(1);

    // A late activity event must not revive anything.
    idle.noteActivity();
    vi.advanceTimersByTime(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the wallet is locked", () => {
    const { idle, onIdle } = setup(false);
    idle.start();

    vi.advanceTimersByTime(60_000);
    idle.check();
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("stops counting after stop()", () => {
    const { idle, onIdle } = setup();
    idle.start();
    idle.stop();

    vi.advanceTimersByTime(60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
