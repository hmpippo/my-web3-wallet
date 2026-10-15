import { createPublicClient, defineChain, http } from "viem";

export const CHAIN = defineChain({
  id: 11155111,
  name: "Sepolia",
  rpcUrls: {
    default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] },
  },
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  blockExplorers: {
    default: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
  },
});

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(),
});
