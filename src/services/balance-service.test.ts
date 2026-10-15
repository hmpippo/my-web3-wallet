import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBalance } = vi.hoisted(() => ({ getBalance: vi.fn() }));

vi.mock("@/core/chain", () => ({
  publicClient: { getBalance },
}));

import { getNativeBalance } from "./balance-service";

describe("native balance service", () => {
  beforeEach(() => getBalance.mockReset());

  it("returns the native-token balance for an address", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    getBalance.mockResolvedValue(BigInt(42));

    await expect(getNativeBalance(address)).resolves.toBe(BigInt(42));
    expect(getBalance).toHaveBeenCalledWith({ address });
  });
});
