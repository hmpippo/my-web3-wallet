import { beforeEach, describe, expect, it, vi } from "vitest";

const { estimateGas, getGasPrice, sendTransaction, walletClientFactory } =
  vi.hoisted(() => ({
    estimateGas: vi.fn(),
    getGasPrice: vi.fn(),
    sendTransaction: vi.fn(),
    walletClientFactory: vi.fn(),
  }));

vi.mock("@/core/chain", () => ({
  getPublicClient: () => ({ estimateGas, getGasPrice }),
  getChain: () => ({ id: 11155111 }),
  getRpcUrl: () => "https://rpc.test",
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createWalletClient: walletClientFactory,
    http: vi.fn(() => "mock-transport"),
  };
});

import {
  encodeErc20Transfer,
  estimateErc20Transfer,
  sendErc20Transfer,
  sendNativeTransfer,
} from "./transaction-service";

const SEPOLIA = 11155111;

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
        chainId: SEPOLIA,
        privateKey: `0x${"1".repeat(64)}`,
      }),
    ).rejects.toThrow("Recipient address is invalid");
  });

  it("rejects zero-value transfers before making RPC calls", async () => {
    await expect(
      sendNativeTransfer({
        to: "0x0000000000000000000000000000000000000001",
        value: BigInt(0),
        chainId: SEPOLIA,
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
      sendNativeTransfer({ to, value, chainId: SEPOLIA, privateKey }),
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

    await sendNativeTransfer({ to, value, chainId: SEPOLIA, privateKey, gas, gasPrice });

    expect(estimateGas).not.toHaveBeenCalled();
    expect(getGasPrice).not.toHaveBeenCalled();
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to, value, gas, gasPrice }),
    );
  });
});

describe("ERC-20 transfer", () => {
  const token = "0x0000000000000000000000000000000000000009";
  const recipient = "0x0000000000000000000000000000000000000001";
  const privateKey = `0x${"1".repeat(64)}` as `0x${string}`;

  beforeEach(() => {
    estimateGas.mockReset().mockResolvedValue(BigInt(60_000));
    getGasPrice.mockReset().mockResolvedValue(BigInt(10));
    sendTransaction.mockReset().mockResolvedValue(`0x${"b".repeat(64)}`);
    walletClientFactory.mockReset().mockReturnValue({ sendTransaction });
  });

  it("rejects malformed recipients and zero amounts before making RPC calls", async () => {
    await expect(
      sendErc20Transfer({
        token,
        to: "not-an-address" as `0x${string}`,
        amount: BigInt(1),
        chainId: SEPOLIA,
        privateKey,
      }),
    ).rejects.toThrow("Recipient address is invalid");

    await expect(
      sendErc20Transfer({
        token,
        to: recipient,
        amount: BigInt(0),
        chainId: SEPOLIA,
        privateKey,
      }),
    ).rejects.toThrow("greater than zero");

    expect(estimateGas).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("encodes a transfer call, estimates, and sends to the token contract", async () => {
    const amount = BigInt(1_000);
    const hash = `0x${"b".repeat(64)}` as `0x${string}`;
    const data = encodeErc20Transfer(recipient, amount);

    await expect(
      sendErc20Transfer({ token, to: recipient, amount, chainId: SEPOLIA, privateKey }),
    ).resolves.toBe(hash);

    expect(estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({ to: token, data }),
    );
    expect(getGasPrice).toHaveBeenCalledOnce();
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: token,
        data,
        value: BigInt(0),
        gas: BigInt(60_000),
        gasPrice: BigInt(10),
      }),
    );
  });

  it("reuses reviewed gas parameters without re-estimating", async () => {
    await sendErc20Transfer({
      token,
      to: recipient,
      amount: BigInt(5),
      chainId: SEPOLIA,
      privateKey,
      gas: BigInt(65_000),
      gasPrice: BigInt(12),
    });

    expect(estimateGas).not.toHaveBeenCalled();
    expect(getGasPrice).not.toHaveBeenCalled();
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: token,
        value: BigInt(0),
        gas: BigInt(65_000),
        gasPrice: BigInt(12),
      }),
    );
  });

  it("returns the gas and fee estimate for an ERC-20 transfer", async () => {
    await expect(
      estimateErc20Transfer({
        from: recipient,
        token,
        to: recipient,
        amount: BigInt(7),
        chainId: SEPOLIA,
      }),
    ).resolves.toEqual({
      gas: BigInt(60_000),
      gasPrice: BigInt(10),
      estimatedFee: BigInt(600_000),
    });
  });
});
