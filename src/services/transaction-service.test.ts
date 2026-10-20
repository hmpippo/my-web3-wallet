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
  estimateNativeTransfer,
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

describe("provider error sanitation", () => {
  const to = "0x0000000000000000000000000000000000000001";
  const token = "0x0000000000000000000000000000000000000009";
  const privateKey = `0x${"1".repeat(64)}` as `0x${string}`;

  function named(name: string, message = "provider detail"): Error {
    const error = new Error(message);
    error.name = name;
    return error;
  }

  beforeEach(() => {
    estimateGas.mockReset().mockResolvedValue(BigInt(21_000));
    getGasPrice.mockReset().mockResolvedValue(BigInt(10));
    sendTransaction.mockReset();
    walletClientFactory.mockReset().mockReturnValue({ sendTransaction });
  });

  it("maps insufficient funds to fixed local text", async () => {
    estimateGas.mockRejectedValueOnce(named("InsufficientFundsError"));

    const error = await estimateNativeTransfer({
      from: to,
      to,
      value: BigInt(1),
      chainId: SEPOLIA,
    }).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "This account does not have enough ETH to cover the transfer and network fee.",
    );
    expect((error as Error).message).not.toContain("provider detail");
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it("does not reflect a send failure and keeps the original cause", async () => {
    const providerError = new Error("rpc detail: visit evil.example");
    sendTransaction.mockRejectedValueOnce(providerError);

    const error = await sendNativeTransfer({
      to,
      value: BigInt(1),
      chainId: SEPOLIA,
      privateKey,
    }).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "The transaction could not be sent. Check your connection and try again.",
    );
    expect((error as Error).message).not.toContain("evil.example");
    expect((error as Error).cause).toBe(providerError);
  });

  it("maps a nested contract revert for a token transfer", async () => {
    const revert = named("ContractFunctionRevertedError");
    const execution = new Error("execution failed", { cause: revert });
    sendTransaction.mockRejectedValueOnce(execution);

    const error = await sendErc20Transfer({
      token,
      to,
      amount: BigInt(1),
      chainId: SEPOLIA,
      privateKey,
    }).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "The token contract rejected the transfer. Check the amount and token rules.",
    );
    expect((error as Error).cause).toBe(execution);
  });

  it("maps timeouts during ERC-20 estimation", async () => {
    estimateGas.mockRejectedValueOnce(named("TimeoutError"));

    await expect(
      estimateErc20Transfer({
        from: to,
        token,
        to,
        amount: BigInt(1),
        chainId: SEPOLIA,
      }),
    ).rejects.toThrow(
      "The network request timed out. Check your connection and try again.",
    );
  });
});
