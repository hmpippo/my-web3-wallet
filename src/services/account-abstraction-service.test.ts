import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCode,
  estimateGas,
  estimateFeesPerGas,
  signAuthorization,
  sendTransaction,
  walletClientFactory,
} = vi.hoisted(() => ({
  getCode: vi.fn(),
  estimateGas: vi.fn(),
  estimateFeesPerGas: vi.fn(),
  signAuthorization: vi.fn(),
  sendTransaction: vi.fn(),
  walletClientFactory: vi.fn(),
}));

vi.mock("@/core/chain", () => ({
  getPublicClient: () => ({ getCode, estimateGas, estimateFeesPerGas }),
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

import { zeroAddress } from "viem";
import { MAX_FEE_PER_GAS } from "@/core/fees";
import {
  parseDelegation,
  readDelegatedAddress,
  revokeDelegation,
} from "./account-abstraction-service";

const SEPOLIA = 11155111;
const ACCOUNT = "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e" as const;

describe("parseDelegation", () => {
  it("returns null for empty or missing code", () => {
    expect(parseDelegation(undefined)).toBeNull();
    expect(parseDelegation("0x")).toBeNull();
  });

  it("extracts and checksums the delegate from a 7702 designator", () => {
    // 0xef0100 || delegate address, as returned by eth_getCode.
    expect(
      parseDelegation("0xef0100a0cf798816d4b9b9866b5330eea46a18382f251e"),
    ).toBe("0xA0Cf798816D4b9b9866b5330EEa46a18382f251e");
  });

  it("returns null for regular contract code and malformed indicators", () => {
    // Ordinary runtime bytecode is not a delegation.
    expect(parseDelegation("0x6001600155")).toBeNull();
    // Correct prefix but a truncated / non-hex payload.
    expect(parseDelegation("0xef0100a0cf798816d4b9b9866b5330eea46a18382f25")).toBeNull();
    expect(parseDelegation("0xef0100zzcf798816d4b9b9866b5330eea46a18382f251e")).toBeNull();
  });
});

describe("readDelegatedAddress", () => {
  beforeEach(() => getCode.mockReset());

  it("reads the account code and returns the delegate address", async () => {
    getCode.mockResolvedValue(
      "0xef0100a0cf798816d4b9b9866b5330eea46a18382f251e",
    );

    await expect(readDelegatedAddress(ACCOUNT, SEPOLIA)).resolves.toBe(
      "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e",
    );
    expect(getCode).toHaveBeenCalledWith({ address: ACCOUNT });
  });

  it("returns null when the account has no delegation", async () => {
    getCode.mockResolvedValue("0x");

    await expect(readDelegatedAddress(ACCOUNT, SEPOLIA)).resolves.toBeNull();
  });

  it("does not reflect provider text when the code read fails", async () => {
    const providerError = new Error("rpc detail: visit evil.example");
    getCode.mockRejectedValueOnce(providerError);

    const error = await readDelegatedAddress(ACCOUNT, SEPOLIA).catch(
      (caught: unknown) => caught,
    );

    expect((error as Error).message).toBe(
      "Could not read the account delegation. Check the network and try again.",
    );
    expect((error as Error).message).not.toContain("evil.example");
    expect((error as Error).cause).toBe(providerError);
  });
});

describe("revokeDelegation", () => {
  const privateKey = `0x${"1".repeat(64)}` as const;

  beforeEach(() => {
    estimateGas.mockReset().mockResolvedValue(BigInt(50_000));
    estimateFeesPerGas.mockReset().mockResolvedValue({
      maxFeePerGas: BigInt(20),
      maxPriorityFeePerGas: BigInt(2),
    });
    signAuthorization.mockReset().mockResolvedValue({
      address: "0x0000000000000000000000000000000000000000",
      chainId: SEPOLIA,
      nonce: 7,
    });
    sendTransaction.mockReset().mockResolvedValue(`0x${"c".repeat(64)}`);
    walletClientFactory.mockReset().mockReturnValue({
      signAuthorization,
      sendTransaction,
    });
  });

  it("authorizes the zero address and sends a type-4 transaction from the account", async () => {
    const hash = `0x${"c".repeat(64)}`;

    await expect(
      revokeDelegation({ address: ACCOUNT, chainId: SEPOLIA, privateKey }),
    ).resolves.toBe(hash);

    expect(signAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: zeroAddress,
        executor: "self",
      }),
    );
    expect(estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ACCOUNT,
        data: "0x",
        value: BigInt(0),
        authorizationList: [
          expect.objectContaining({ address: zeroAddress }),
        ],
      }),
    );
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ACCOUNT,
        data: "0x",
        value: BigInt(0),
        gas: BigInt(50_000),
        maxFeePerGas: BigInt(20),
        maxPriorityFeePerGas: BigInt(2),
        authorizationList: [
          expect.objectContaining({ address: zeroAddress }),
        ],
      }),
    );
  });

  it("refuses an over-cap fee before broadcasting the revoke", async () => {
    estimateFeesPerGas.mockResolvedValueOnce({
      maxFeePerGas: MAX_FEE_PER_GAS + BigInt(1),
      maxPriorityFeePerGas: BigInt(1),
    });

    await expect(
      revokeDelegation({ address: ACCOUNT, chainId: SEPOLIA, privateKey }),
    ).rejects.toThrow("maximum fee per gas is unusually high");
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("does not reflect a revoke failure and keeps the cause", async () => {
    const providerError = new Error("rpc detail: visit evil.example");
    sendTransaction.mockRejectedValueOnce(providerError);

    const error = await revokeDelegation({
      address: ACCOUNT,
      chainId: SEPOLIA,
      privateKey,
    }).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "Could not revoke the delegation. Check the network and try again.",
    );
    expect((error as Error).message).not.toContain("evil.example");
    expect((error as Error).cause).toBe(providerError);
  });

  it("maps insufficient funds when revoking", async () => {
    const insufficient = new Error("provider detail");
    insufficient.name = "InsufficientFundsError";
    sendTransaction.mockRejectedValueOnce(insufficient);

    await expect(
      revokeDelegation({ address: ACCOUNT, chainId: SEPOLIA, privateKey }),
    ).rejects.toThrow(
      "This account does not have enough ETH to cover the transfer and network fee.",
    );
  });
});
