import { beforeEach, describe, expect, it, vi } from "vitest";

const { readContract } = vi.hoisted(() => ({
  readContract: vi.fn(),
}));

vi.mock("@/core/chain", () => ({
  publicClient: { readContract },
}));

import {
  getTokenBalance,
  normalizeTokenAddress,
  readTokenMetadata,
} from "./token-service";

const TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001";
const WALLET_ADDRESS = "0x0000000000000000000000000000000000000002";

describe("ERC-20 token service", () => {
  beforeEach(() => readContract.mockReset());

  it("normalizes valid addresses and rejects invalid contract addresses", () => {
    expect(normalizeTokenAddress(TOKEN_ADDRESS)).toBe(
      "0x0000000000000000000000000000000000000001",
    );
    expect(() => normalizeTokenAddress("not-an-address")).toThrow(
      "valid ERC-20 contract address",
    );
  });

  it("reads and validates on-chain token metadata", async () => {
    readContract
      .mockResolvedValueOnce("USD Coin")
      .mockResolvedValueOnce("USDC")
      .mockResolvedValueOnce(6);

    await expect(
      readTokenMetadata(normalizeTokenAddress(TOKEN_ADDRESS)),
    ).resolves.toMatchObject({
      address: TOKEN_ADDRESS,
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
    });
    expect(readContract).toHaveBeenCalledTimes(3);
  });

  it("returns a clear error if contract metadata calls fail or are invalid", async () => {
    readContract.mockRejectedValue(new Error("RPC unavailable"));
    await expect(
      readTokenMetadata(normalizeTokenAddress(TOKEN_ADDRESS)),
    ).rejects.toThrow("Could not read ERC-20 name, symbol, and decimals");

    readContract.mockReset();
    readContract
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("BAD")
      .mockResolvedValueOnce(18);
    await expect(
      readTokenMetadata(normalizeTokenAddress(TOKEN_ADDRESS)),
    ).rejects.toThrow("invalid token metadata");
  });

  it("formats bigint token balances exactly using contract decimals", async () => {
    const raw = BigInt("123456789012345678901234");
    readContract.mockResolvedValueOnce(raw);

    await expect(
      getTokenBalance(
        { address: TOKEN_ADDRESS, decimals: 6, symbol: "USDC" },
        WALLET_ADDRESS,
      ),
    ).resolves.toEqual({
      raw,
      formatted: "123456789012345678.901234",
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "balanceOf",
        args: [WALLET_ADDRESS],
      }),
    );
  });
});
