import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBalance } = vi.hoisted(() => ({ getBalance: vi.fn() }));

vi.mock("@/core/chain", () => ({
  getPublicClient: () => ({ getBalance }),
}));

import { getNativeBalance } from "./balance-service";

describe("native balance service", () => {
  beforeEach(() => getBalance.mockReset());

  it("returns the native-token balance for an address on the given chain", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    getBalance.mockResolvedValue(BigInt(42));

    await expect(getNativeBalance(address, 11155111)).resolves.toBe(BigInt(42));
    expect(getBalance).toHaveBeenCalledWith({ address });
  });
});

describe("balance error sanitation", () => {
  const address = "0x0000000000000000000000000000000000000001";

  it("does not reflect provider text", async () => {
    const providerError = new Error("rpc detail: visit evil.example");
    getBalance.mockRejectedValueOnce(providerError);

    const error = await getNativeBalance(address, 11155111).catch(
      (caught: unknown) => caught,
    );

    expect((error as Error).message).toBe(
      "Could not load the native balance. Check your connection and try again.",
    );
    expect((error as Error).message).not.toContain("evil.example");
    expect((error as Error).cause).toBe(providerError);
  });
});
