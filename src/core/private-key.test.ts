import { describe, expect, it } from "vitest";
import { addressFromPrivateKey, normalizePrivateKey } from "./private-key";

const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("normalizePrivateKey", () => {
  it("accepts a prefixed key and returns it in canonical form", () => {
    expect(normalizePrivateKey(PRIVATE_KEY)).toBe(PRIVATE_KEY);
  });

  it("adds a missing 0x prefix and trims surrounding whitespace", () => {
    expect(normalizePrivateKey(`  ${PRIVATE_KEY.slice(2)}  `)).toBe(PRIVATE_KEY);
  });

  it("lowercases an uppercase key", () => {
    const upper = `0x${PRIVATE_KEY.slice(2).toUpperCase()}`;
    expect(normalizePrivateKey(upper)).toBe(PRIVATE_KEY);
  });

  it("rejects keys that are not 64 hexadecimal characters", () => {
    expect(() => normalizePrivateKey("")).toThrow("Enter the private key");
    expect(() => normalizePrivateKey("0x1234")).toThrow("64 hexadecimal");
    expect(() => normalizePrivateKey(`${PRIVATE_KEY}ab`)).toThrow(
      "64 hexadecimal",
    );
    expect(() => normalizePrivateKey(`0x${"z".repeat(64)}`)).toThrow(
      "64 hexadecimal",
    );
  });
});

describe("addressFromPrivateKey", () => {
  it("derives the checksummed address for a valid key", () => {
    expect(addressFromPrivateKey(PRIVATE_KEY)).toBe(ADDRESS);
  });

  it("rejects a key that is not a valid secp256k1 scalar", () => {
    expect(() =>
      addressFromPrivateKey(`0x${"0".repeat(64)}` as `0x${string}`),
    ).toThrow("not a valid EVM key");
  });
});
