import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAIN_ID,
  getChain,
  getExplorerTxUrl,
  getPublicClient,
  getRpcUrl,
  isSupportedChainId,
  supportsHistory,
} from "./chain";

describe("chain registry", () => {
  it("defaults to the Sepolia testnet", () => {
    expect(DEFAULT_CHAIN_ID).toBe(11155111);
    expect(getChain(DEFAULT_CHAIN_ID).name).toBe("Sepolia");
  });

  it("exposes Sepolia, Base Sepolia, and the major mainnets", () => {
    const ids = [
      1, 8453, 42161, 10, 137, 11155111, 84532,
    ];
    for (const id of ids) {
      expect(isSupportedChainId(id)).toBe(true);
    }
    expect(isSupportedChainId(999999)).toBe(false);
    expect(isSupportedChainId("1")).toBe(false);
  });

  it("uses a public RPC fallback per chain", () => {
    expect(getRpcUrl(11155111)).toBe(
      "https://ethereum-sepolia-rpc.publicnode.com",
    );
    expect(getRpcUrl(8453)).toBe("https://base-rpc.publicnode.com");
  });

  it("marks chains without free-tier history as unsupported", () => {
    expect(supportsHistory(11155111)).toBe(true);
    expect(supportsHistory(1)).toBe(true);
    expect(supportsHistory(8453)).toBe(false);
    expect(supportsHistory(10)).toBe(false);
  });

  it("builds explorer transaction links from the active chain", () => {
    expect(getExplorerTxUrl(11155111, "0xabc")).toBe(
      "https://sepolia.etherscan.io/tx/0xabc",
    );
    expect(getExplorerTxUrl(137, "0xabc")).toBe(
      "https://polygonscan.com/tx/0xabc",
    );
  });

  it("returns a cached public client configured for each chain", () => {
    const sepoliaClient = getPublicClient(11155111);
    expect(sepoliaClient.chain?.id).toBe(11155111);
    expect(getPublicClient(11155111)).toBe(sepoliaClient);

    const baseClient = getPublicClient(8453);
    expect(baseClient.chain?.id).toBe(8453);
    expect(baseClient).not.toBe(sepoliaClient);
  });

  it("rejects unsupported chains", () => {
    expect(() => getChain(999999)).toThrow("Unsupported chain id");
    expect(() => getRpcUrl(999999)).toThrow("Unsupported chain id");
    expect(() => getPublicClient(999999)).toThrow("Unsupported chain id");
  });
});
