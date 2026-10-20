import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("rate limiter", () => {
  it("allows the limit and refuses until the window resets", () => {
    let now = 1_000;
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 60_000,
      now: () => now,
    });

    expect(limiter.consume("ip")).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.consume("ip").allowed).toBe(true);
    expect(limiter.consume("ip").allowed).toBe(true);

    expect(limiter.consume("ip")).toEqual({
      allowed: false,
      retryAfterMs: 60_000,
    });

    now += 59_000;
    expect(limiter.consume("ip")).toEqual({
      allowed: false,
      retryAfterMs: 1_000,
    });

    now += 1_000;
    expect(limiter.consume("ip").allowed).toBe(true);
  });

  it("keeps keys independent", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1_000,
      now: () => 0,
    });

    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    expect(limiter.consume("b").allowed).toBe(true);
  });

  it("resets every bucket", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1_000,
      now: () => 0,
    });

    limiter.consume("a");
    expect(limiter.consume("a").allowed).toBe(false);

    limiter.reset();
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("validates its options", () => {
    expect(() =>
      createRateLimiter({ limit: 0, windowMs: 1_000 }),
    ).toThrow(RangeError);
    expect(() =>
      createRateLimiter({ limit: 1, windowMs: 0 }),
    ).toThrow(RangeError);
  });
});
