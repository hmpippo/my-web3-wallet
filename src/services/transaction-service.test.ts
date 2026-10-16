import { beforeEach, describe, expect, it, vi } from "vitest";

const { estimateGas, getGasPrice, sendTransaction, walletClientFactory } =
  vi.hoisted(() => ({
    estimateGas: vi.fn(),
    getGasPrice: vi.fn(),
    sendTransaction: vi.fn(),
    walletClientFactory: vi.fn(),
  }));

vi.mock("@/core/chain", () => ({
  CHAIN: { id: 11155111 },
  publicClient: { estimateGas, getGasPrice },
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createWalletClient: walletClientFactory,
    http: vi.fn(() => "mock-transport"),
  };
});

import { sendNativeTransfer } from "./transaction-service";

describe("native transfer validation", () => {
  beforeEach(() => {
    estimateGas.mockReset().mockResolvedValue(BigInt(21_000));
    getGasPrice.mockReset().mockResolvedValue(BigInt(10));
    sendTransaction.mockReset().mockResolvedValue(
      `0x${"a".repeat(64)}`,
    );
    walletClientFactory.mockReset().mockReturnValue({ sendTransaction });
  });

  it("rejects malformed recipient addresses before making RPC calls", async () => {
    await expect(
      sendNativeTransfer({
        to: "not-an-address" as `0x${string}`,
        value: BigInt(1),
        privateKey: `0x${"1".repeat(64)}`,
      }),
    ).rejects.toThrow("Recipient address is invalid");
  });

  it("rejects zero-value transfers before making RPC calls", async () => {
    await expect(
      sendNativeTransfer({
        to: "0x0000000000000000000000000000000000000001",
        value: BigInt(0),
        privateKey: `0x${"1".repeat(64)}`,
      }),
    ).rejects.toThrow("greater than zero");
  });

  it("estimates gas and gas price before sending a native transfer", async () => {
    const to = "0x0000000000000000000000000000000000000001";
    const privateKey = `0x${"1".repeat(64)}` as `0x${string}`;
    const value = BigInt(123);
    const hash = `0x${"a".repeat(64)}` as `0x${string}`;

    await expect(
      sendNativeTransfer({ to, value, privateKey }),
    ).resolves.toBe(hash);

    expect(estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({ to, value }),
    );
    expect(getGasPrice).toHaveBeenCalledOnce();
    expect(walletClientFactory).toHaveBeenCalledOnce();
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to,
        value,
        gas: BigInt(21_000),
        gasPrice: BigInt(10),
      }),
    );
  });

  it("sends with the exact gas parameters shown in the review", async () => {
    const to = "0x0000000000000000000000000000000000000001";
    const privateKey = `0x${"1".repeat(64)}` as `0x${string}`;
    const value = BigInt(123);
    const gas = BigInt(23_000);
    const gasPrice = BigInt(12);

    await sendNativeTransfer({ to, value, privateKey, gas, gasPrice });

    expect(estimateGas).not.toHaveBeenCalled();
    expect(getGasPrice).not.toHaveBeenCalled();
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to, value, gas, gasPrice }),
    );
  });
});
