import { describe, expect, it } from "vitest";
import {
  bytesToSecret,
  secretToBytes,
  wipeBytes,
  wipeSecretMap,
} from "./secret";

const KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("secret byte helpers", () => {
  it("round-trips a private key", () => {
    const bytes = secretToBytes(KEY);
    expect(bytes).toHaveLength(32);
    expect(bytes[0]).toBe(0x01);
    expect(bytesToSecret(bytes)).toBe(KEY);
  });

  it("returns a copy that can be wiped", () => {
    const bytes = secretToBytes(KEY);
    wipeBytes(bytes);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("tolerates a missing buffer", () => {
    expect(() => wipeBytes(null)).not.toThrow();
    expect(() => wipeBytes(undefined)).not.toThrow();
  });

  it("wipes every key in the map before clearing it", () => {
    const first = secretToBytes(KEY);
    const second = secretToBytes(KEY);
    const map = new Map([
      [0, first],
      [1, second],
    ]);

    wipeSecretMap(map);

    expect(map.size).toBe(0);
    expect(first.every((byte) => byte === 0)).toBe(true);
    expect(second.every((byte) => byte === 0)).toBe(true);
  });
});
