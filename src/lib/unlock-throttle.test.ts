import { describe, expect, it } from "vitest";
import {
  createUnlockThrottle,
  DEFAULT_UNLOCK_COOLDOWN_MS,
  UNLOCK_FAILURE_LIMIT,
} from "./unlock-throttle";

interface StorageMock {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createStorageMock(): StorageMock {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("unlock throttle", () => {
  it("allows two failures and blocks on the third", () => {
    const now = 1_000;
    const throttle = createUnlockThrottle({
      now: () => now,
      storage: null,
    });

    expect(UNLOCK_FAILURE_LIMIT).toBe(3);
    expect(throttle.retryAfterMs("wallet")).toBe(0);

    throttle.recordFailure("wallet");
    expect(throttle.retryAfterMs("wallet")).toBe(0);

    throttle.recordFailure("wallet");
    expect(throttle.retryAfterMs("wallet")).toBe(0);

    throttle.recordFailure("wallet");
    expect(throttle.retryAfterMs("wallet")).toBe(
      DEFAULT_UNLOCK_COOLDOWN_MS,
    );
  });

  it("counts the cooldown down and then grants a fresh set of attempts", () => {
    let now = 0;
    const throttle = createUnlockThrottle({
      cooldownMs: 30_000,
      now: () => now,
      storage: null,
    });

    throttle.recordFailure("wallet");
    throttle.recordFailure("wallet");
    throttle.recordFailure("wallet");

    now += 29_999;
    expect(throttle.retryAfterMs("wallet")).toBe(1);

    now += 1;
    expect(throttle.retryAfterMs("wallet")).toBe(0);

    // The served cooldown resets the counter, so two more tries are free.
    throttle.recordFailure("wallet");
    expect(throttle.retryAfterMs("wallet")).toBe(0);
    throttle.recordFailure("wallet");
    expect(throttle.retryAfterMs("wallet")).toBe(0);

    throttle.recordFailure("wallet");
    expect(throttle.retryAfterMs("wallet")).toBe(30_000);
  });

  it("honours an injected cooldown", () => {
    let now = 0;
    const throttle = createUnlockThrottle({
      cooldownMs: 5,
      now: () => now,
      storage: null,
    });

    throttle.recordFailure("wallet");
    throttle.recordFailure("wallet");
    throttle.recordFailure("wallet");
    expect(throttle.retryAfterMs("wallet")).toBe(5);

    now += 5;
    expect(throttle.retryAfterMs("wallet")).toBe(0);
  });

  it("persists state across throttle instances", () => {
    const storage = createStorageMock();
    const now = 0;
    const options = { cooldownMs: 30_000, now: () => now, storage };

    const first = createUnlockThrottle(options);
    first.recordFailure("wallet");
    first.recordFailure("wallet");
    first.recordFailure("wallet");

    const second = createUnlockThrottle(options);
    expect(second.retryAfterMs("wallet")).toBe(30_000);

    second.recordSuccess("wallet");
    expect(second.retryAfterMs("wallet")).toBe(0);
    expect(createUnlockThrottle(options).retryAfterMs("wallet")).toBe(0);
  });

  it("keeps wallets independent", () => {
    const now = 0;
    const throttle = createUnlockThrottle({
      now: () => now,
      storage: null,
    });

    throttle.recordFailure("one");
    throttle.recordFailure("one");
    throttle.recordFailure("one");

    expect(throttle.retryAfterMs("one")).toBe(30_000);
    expect(throttle.retryAfterMs("two")).toBe(0);
  });

  it("forgets a counter that is more than a day old", () => {
    let now = 0;
    const throttle = createUnlockThrottle({
      now: () => now,
      storage: null,
    });

    throttle.recordFailure("wallet");
    throttle.recordFailure("wallet");

    now += 24 * 60 * 60 * 1000 + 1;
    expect(throttle.retryAfterMs("wallet")).toBe(0);

    // Fresh state: two failures no longer block.
    throttle.recordFailure("wallet");
    throttle.recordFailure("wallet");
    expect(throttle.retryAfterMs("wallet")).toBe(0);
  });

  it("ignores corrupt persisted state", () => {
    const storage = createStorageMock();
    storage.setItem("wallet_unlock_failures_v1:wallet", "{not json");
    const throttle = createUnlockThrottle({ storage });

    expect(throttle.retryAfterMs("wallet")).toBe(0);
    throttle.recordFailure("wallet");
    expect(throttle.retryAfterMs("wallet")).toBe(0);
  });
});
