import { describe, expect, it } from "vitest";
import { CHAIN, publicClient } from "./chain";

describe("chain adapter", () => {
  it("configures Sepolia as the sole supported chain", () => {
    expect(CHAIN.id).toBe(11155111);
    expect(CHAIN.name).toBe("Sepolia");
    expect(CHAIN.rpcUrls.default.http[0]).toBe(
      "https://ethereum-sepolia-rpc.publicnode.com",
    );
    expect(CHAIN.blockExplorers.default.url).toBe(
      "https://sepolia.etherscan.io",
    );
  });

  it("exports a public client configured for Sepolia", () => {
    expect(publicClient.chain?.id).toBe(11155111);
  });
});
