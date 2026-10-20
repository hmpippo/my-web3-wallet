import { beforeEach, describe, expect, it, vi } from "vitest";

const { estimateGas, estimateFeesPerGas, sendTransaction, walletClientFactory } =
  vi.hoisted(() => ({
    estimateGas: vi.fn(),
    estimateFeesPerGas: vi.fn(),
    sendTransaction: vi.fn(),
    walletClientFactory: vi.fn(),
  }));

vi.mock("@/core/chain", () => ({
  getPublicClient: () => ({ estimateGas, estimateFeesPerGas }),
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

import { MAX_FEE_PER_GAS, MAX_GAS_LIMIT } from "@/core/fees";
import {
  encodeErc20Transfer,
  estimateErc20Transfer,
  estimateNativeTransfer,
  sendErc20Transfer,
  sendNativeTransfer,
} from "./transaction-service";

const SEPOLIA = 11155111;
const FEES = { maxFeePerGas: BigInt(20), maxPriorityFeePerGas: BigInt(2) };

describe("native transfer validation", () => {
  beforeEach(() => {
    estimateGas.mockReset().mockResolvedValue(BigInt(21_000));
    estimateFeesPerGas.mockReset().mockResolvedValue(FEES);
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

  it("estimates gas and EIP-1559 fees before sending a native transfer", async () => {
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
    expect(estimateFeesPerGas).toHaveBeenCalledOnce();
    expect(walletClientFactory).toHaveBeenCalledOnce();
    const sent = sendTransaction.mock.calls[0]?.[0];
    expect(sent).toEqual(
      expect.objectContaining({
        to,
        value,
        gas: BigInt(21_000),
        maxFeePerGas: FEES.maxFeePerGas,
        maxPriorityFeePerGas: FEES.maxPriorityFeePerGas,
      }),
    );
    expect(sent).not.toHaveProperty("gasPrice");
  });

  it("sends with the exact fee parameters shown in the review", async () => {
    const to = "0x0000000000000000000000000000000000000001";
    const privateKey = `0x${"1".repeat(64)}` as `0x${string}`;
    const value = BigInt(123);
    const gas = BigInt(23_000);
    const maxFeePerGas = BigInt(12);
    const maxPriorityFeePerGas = BigInt(1);

    await sendNativeTransfer({
      to,
      value,
      chainId: SEPOLIA,
      privateKey,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    expect(estimateGas).not.toHaveBeenCalled();
    expect(estimateFeesPerGas).not.toHaveBeenCalled();
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to,
        value,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
      }),
    );
  });
});

describe("ERC-20 transfer", () => {
  const token = "0x0000000000000000000000000000000000000009";
  const recipient = "0x0000000000000000000000000000000000000001";
  const privateKey = `0x${"1".repeat(64)}` as `0x${string}`;

  beforeEach(() => {
    estimateGas.mockReset().mockResolvedValue(BigInt(60_000));
    estimateFeesPerGas.mockReset().mockResolvedValue(FEES);
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
    expect(estimateFeesPerGas).toHaveBeenCalledOnce();
    const sent = sendTransaction.mock.calls[0]?.[0];
    expect(sent).toEqual(
      expect.objectContaining({
        to: token,
        data,
        value: BigInt(0),
        gas: BigInt(60_000),
        maxFeePerGas: FEES.maxFeePerGas,
        maxPriorityFeePerGas: FEES.maxPriorityFeePerGas,
      }),
    );
    expect(sent).not.toHaveProperty("gasPrice");
  });

  it("reuses reviewed fee parameters without re-estimating", async () => {
    await sendErc20Transfer({
      token,
      to: recipient,
      amount: BigInt(5),
      chainId: SEPOLIA,
      privateKey,
      gas: BigInt(65_000),
      maxFeePerGas: BigInt(12),
      maxPriorityFeePerGas: BigInt(1),
    });

    expect(estimateGas).not.toHaveBeenCalled();
    expect(estimateFeesPerGas).not.toHaveBeenCalled();
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: token,
        value: BigInt(0),
        gas: BigInt(65_000),
        maxFeePerGas: BigInt(12),
        maxPriorityFeePerGas: BigInt(1),
      }),
    );
  });

  it("returns the EIP-1559 estimate for an ERC-20 transfer", async () => {
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
      maxFeePerGas: FEES.maxFeePerGas,
      maxPriorityFeePerGas: FEES.maxPriorityFeePerGas,
      maxTotalFee: BigInt(1_200_000),
    });
  });
});

describe("fee policy", () => {
  const to = "0x0000000000000000000000000000000000000001";
  const privateKey = `0x${"1".repeat(64)}` as `0x${string}`;

  beforeEach(() => {
    estimateGas.mockReset().mockResolvedValue(BigInt(21_000));
    estimateFeesPerGas.mockReset().mockResolvedValue(FEES);
    sendTransaction.mockReset().mockResolvedValue(`0x${"a".repeat(64)}`);
    walletClientFactory.mockReset().mockReturnValue({ sendTransaction });
  });

  it("rejects a provider proposal above the max-fee cap", async () => {
    estimateFeesPerGas.mockResolvedValueOnce({
      maxFeePerGas: MAX_FEE_PER_GAS + BigInt(1),
      maxPriorityFeePerGas: BigInt(1),
    });

    await expect(
      estimateNativeTransfer({ from: to, to, value: BigInt(1), chainId: SEPOLIA }),
    ).rejects.toThrow("maximum fee per gas is unusually high");
  });

  it("rejects a total above the total-fee cap", async () => {
    estimateGas.mockResolvedValueOnce(MAX_GAS_LIMIT);
    estimateFeesPerGas.mockResolvedValueOnce({
      maxFeePerGas: MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: BigInt(1),
    });

    await expect(
      estimateNativeTransfer({ from: to, to, value: BigInt(1), chainId: SEPOLIA }),
    ).rejects.toThrow("maximum network fee is unusually high");
  });

  it("rejects reviewed values above the cap before signing", async () => {
    const error = await sendNativeTransfer({
      to,
      value: BigInt(1),
      chainId: SEPOLIA,
      privateKey,
      gas: BigInt(21_000),
      maxFeePerGas: MAX_FEE_PER_GAS + BigInt(1),
      maxPriorityFeePerGas: BigInt(1),
    }).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "The proposed maximum fee per gas is unusually high. Try again later.",
    );
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects a partially reviewed fee instead of re-estimating", async () => {
    const error = await sendNativeTransfer({
      to,
      value: BigInt(1),
      chainId: SEPOLIA,
      privateKey,
      gas: BigInt(21_000),
    }).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "The reviewed fee is incomplete. Estimate the transfer again.",
    );
    expect(estimateGas).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects a priority fee above the max fee", async () => {
    await expect(
      sendNativeTransfer({
        to,
        value: BigInt(1),
        chainId: SEPOLIA,
        privateKey,
        gas: BigInt(21_000),
        maxFeePerGas: BigInt(10),
        maxPriorityFeePerGas: BigInt(11),
      }),
    ).rejects.toThrow("priority fee cannot exceed");
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects a network without EIP-1559 fee data", async () => {
    estimateFeesPerGas.mockResolvedValueOnce({ gasPrice: BigInt(10) });

    await expect(
      estimateNativeTransfer({ from: to, to, value: BigInt(1), chainId: SEPOLIA }),
    ).rejects.toThrow("did not return EIP-1559 fees");
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
    estimateFeesPerGas.mockReset().mockResolvedValue(FEES);
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

  it("maps unsupported EIP-1559 fees to fixed local text", async () => {
    estimateFeesPerGas.mockRejectedValueOnce(
      named("Eip1559FeesNotSupportedError"),
    );

    await expect(
      estimateNativeTransfer({ from: to, to, value: BigInt(1), chainId: SEPOLIA }),
    ).rejects.toThrow("This network does not support EIP-1559 fees.");
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
