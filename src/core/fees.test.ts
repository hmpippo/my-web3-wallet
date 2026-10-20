import { describe, expect, it } from "vitest";
import {
  HIGH_FEE_PER_GAS,
  HIGH_TOTAL_FEE,
  isUnusuallyHighFee,
  MAX_FEE_PER_GAS,
  MAX_GAS_LIMIT,
  MAX_PRIORITY_FEE_PER_GAS,
  MAX_TOTAL_FEE,
  NetworkFeeError,
  validateNetworkFee,
} from "./fees";

const GWEI = BigInt(1_000_000_000);

function fee(overrides: Partial<Parameters<typeof validateNetworkFee>[0]> = {}) {
  return {
    gas: BigInt(21_000),
    maxFeePerGas: BigInt(20) * GWEI,
    maxPriorityFeePerGas: BigInt(2) * GWEI,
    ...overrides,
  };
}

describe("validateNetworkFee", () => {
  it("accepts a normal fee and returns the maximum total", () => {
    expect(validateNetworkFee(fee())).toBe(BigInt(21_000) * BigInt(20) * GWEI);
  });

  it("accepts values exactly at the ceilings", () => {
    const maxTotal = MAX_GAS_LIMIT * MAX_FEE_PER_GAS;
    expect(maxTotal).toBeGreaterThan(MAX_TOTAL_FEE);

    // Pick the gas limit that lands exactly on the total ceiling.
    const gas = MAX_TOTAL_FEE / MAX_FEE_PER_GAS;
    expect(
      validateNetworkFee({
        gas,
        maxFeePerGas: MAX_FEE_PER_GAS,
        maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
      }),
    ).toBe(MAX_TOTAL_FEE);
  });

  it("rejects a gas limit above the ceiling", () => {
    expect(() =>
      validateNetworkFee(fee({ gas: MAX_GAS_LIMIT + BigInt(1) })),
    ).toThrow(NetworkFeeError);
    expect(() =>
      validateNetworkFee(fee({ gas: MAX_GAS_LIMIT + BigInt(1) })),
    ).toThrow("gas limit is unusually high");
  });

  it("rejects a max fee per gas above the ceiling", () => {
    expect(() =>
      validateNetworkFee(fee({ maxFeePerGas: MAX_FEE_PER_GAS + BigInt(1) })),
    ).toThrow("maximum fee per gas is unusually high");
  });

  it("rejects a priority fee above its ceiling", () => {
    expect(() =>
      validateNetworkFee(
        fee({ maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS + BigInt(1) }),
      ),
    ).toThrow("priority fee is unusually high");
  });

  it("rejects a priority fee above the max fee", () => {
    expect(() =>
      validateNetworkFee(
        fee({ maxFeePerGas: BigInt(10), maxPriorityFeePerGas: BigInt(11) }),
      ),
    ).toThrow("priority fee cannot exceed");
  });

  it("rejects a total above the ceiling even when each per-gas value is valid", () => {
    expect(() =>
      validateNetworkFee(
        fee({ gas: MAX_GAS_LIMIT, maxFeePerGas: MAX_FEE_PER_GAS }),
      ),
    ).toThrow("maximum network fee is unusually high");
  });

  it.each([
    ["zero gas", { gas: BigInt(0) }],
    ["negative gas", { gas: BigInt(-1) }],
    ["zero max fee", { maxFeePerGas: BigInt(0) }],
    ["negative priority", { maxPriorityFeePerGas: BigInt(-1) }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => validateNetworkFee(fee(overrides))).toThrow(NetworkFeeError);
  });

  it("accepts a zero priority fee, which some L2s return", () => {
    expect(
      validateNetworkFee(fee({ maxPriorityFeePerGas: BigInt(0) })),
    ).toBe(BigInt(21_000) * BigInt(20) * GWEI);
  });

  it("rejects non-bigint values from a tampered review", () => {
    expect(() =>
      validateNetworkFee({
        gas: 21_000 as unknown as bigint,
        maxFeePerGas: BigInt(1),
        maxPriorityFeePerGas: BigInt(1),
      }),
    ).toThrow(NetworkFeeError);
  });
});

describe("isUnusuallyHighFee", () => {
  it("warns at the per-gas threshold", () => {
    expect(
      isUnusuallyHighFee({
        maxFeePerGas: HIGH_FEE_PER_GAS - BigInt(1),
        maxTotalFee: BigInt(0),
      }),
    ).toBe(false);
    expect(
      isUnusuallyHighFee({
        maxFeePerGas: HIGH_FEE_PER_GAS,
        maxTotalFee: BigInt(0),
      }),
    ).toBe(true);
  });

  it("warns at the total threshold", () => {
    expect(
      isUnusuallyHighFee({
        maxFeePerGas: BigInt(1),
        maxTotalFee: HIGH_TOTAL_FEE - BigInt(1),
      }),
    ).toBe(false);
    expect(
      isUnusuallyHighFee({
        maxFeePerGas: BigInt(1),
        maxTotalFee: HIGH_TOTAL_FEE,
      }),
    ).toBe(true);
  });
});
