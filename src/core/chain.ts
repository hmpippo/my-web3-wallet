import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import {
  arbitrum,
  base,
  baseSepolia,
  mainnet,
  optimism,
  polygon,
  sepolia,
} from "viem/chains";

export interface WalletChain {
  /** viem chain definition (id, name, nativeCurrency, blockExplorers). */
  readonly chain: Chain;
  /** Testnets are grouped separately and warned about in the UI. */
  readonly isTestnet: boolean;
  /**
   * Whether the Etherscan V2 activity feed is reachable on the free tier.
   *
   * Chains Etherscan serves only on paid plans are marked `false` so the
   * Activity tab can explain the gap instead of making a doomed request. The
   * history service also detects paid/unsupported responses at runtime, so a
   * plan change degrades gracefully rather than surfacing a raw error.
   */
  readonly historySupported: boolean;
}

/**
 * Public RPC fallbacks, used when no `NEXT_PUBLIC_RPC_URL_<chainId>` override is
 * configured. Public node endpoints keep the wallet working with zero config.
 */
const RPC_FALLBACK_URLS: Record<number, string> = {
  [mainnet.id]: "https://ethereum-rpc.publicnode.com",
  [base.id]: "https://base-rpc.publicnode.com",
  [arbitrum.id]: "https://arbitrum-one-rpc.publicnode.com",
  [optimism.id]: "https://optimism-rpc.publicnode.com",
  [polygon.id]: "https://polygon-bor-rpc.publicnode.com",
  [sepolia.id]: "https://ethereum-sepolia-rpc.publicnode.com",
  [baseSepolia.id]: "https://base-sepolia-rpc.publicnode.com",
};

/**
 * Optional per-chain RPC overrides.
 *
 * Each `process.env.NEXT_PUBLIC_RPC_URL_*` reference is written out literally so
 * Next.js can inline it into the browser bundle; a dynamic lookup would not be
 * replaced and would always be `undefined` on the client.
 */
const RPC_OVERRIDE_URLS: Record<number, string | undefined> = {
  [mainnet.id]: process.env.NEXT_PUBLIC_RPC_URL_1,
  [base.id]: process.env.NEXT_PUBLIC_RPC_URL_8453,
  [arbitrum.id]: process.env.NEXT_PUBLIC_RPC_URL_42161,
  [optimism.id]: process.env.NEXT_PUBLIC_RPC_URL_10,
  [polygon.id]: process.env.NEXT_PUBLIC_RPC_URL_137,
  [sepolia.id]: process.env.NEXT_PUBLIC_RPC_URL_11155111,
  [baseSepolia.id]: process.env.NEXT_PUBLIC_RPC_URL_84532,
};

/**
 * Every chain the wallet can talk to. Testnets and mainnets are interleaved by
 * listing order; the UI groups them itself.
 */
export const SUPPORTED_CHAINS: readonly WalletChain[] = Object.freeze([
  { chain: mainnet, isTestnet: false, historySupported: true },
  { chain: base, isTestnet: false, historySupported: false },
  { chain: arbitrum, isTestnet: false, historySupported: true },
  { chain: optimism, isTestnet: false, historySupported: false },
  { chain: polygon, isTestnet: false, historySupported: true },
  { chain: sepolia, isTestnet: true, historySupported: true },
  { chain: baseSepolia, isTestnet: true, historySupported: true },
]);

/** Sepolia keeps its role as the zero-config default for new sessions. */
export const DEFAULT_CHAIN_ID = sepolia.id;

const CHAINS_BY_ID = new Map<number, WalletChain>(
  SUPPORTED_CHAINS.map((walletChain) => [walletChain.chain.id, walletChain]),
);

const publicClients = new Map<number, PublicClient>();

export function isSupportedChainId(value: unknown): value is number {
  return typeof value === "number" && CHAINS_BY_ID.has(value);
}

export function getWalletChain(chainId: number): WalletChain {
  const walletChain = CHAINS_BY_ID.get(chainId);
  if (!walletChain) {
    throw new RangeError(`Unsupported chain id: ${chainId}`);
  }
  return walletChain;
}

export function getChain(chainId: number): Chain {
  return getWalletChain(chainId).chain;
}

export function supportsHistory(chainId: number): boolean {
  return getWalletChain(chainId).historySupported;
}

/** Resolves the RPC endpoint for a chain (env override, then public fallback). */
export function getRpcUrl(chainId: number): string {
  const chain = getChain(chainId);
  const override = RPC_OVERRIDE_URLS[chain.id]?.trim();
  if (override) return override;
  return (
    RPC_FALLBACK_URLS[chain.id] ??
    chain.rpcUrls.default.http[0] ??
    chain.rpcUrls.default.webSocket?.[0] ??
    ""
  );
}

/** A cached public client per chain, so repeated reads reuse one transport. */
export function getPublicClient(chainId: number): PublicClient {
  const cached = publicClients.get(chainId);
  if (cached) return cached;
  const client = createPublicClient({
    chain: getChain(chainId),
    transport: http(getRpcUrl(chainId)),
  });
  publicClients.set(chainId, client);
  return client;
}

/** The explorer home for a chain, or `null` when none is known. */
export function getExplorerUrl(chainId: number): string | null {
  return getWalletChain(chainId).chain.blockExplorers?.default?.url ?? null;
}

/** A block explorer transaction link, or `null` when the chain has no explorer. */
export function getExplorerTxUrl(chainId: number, hash: string): string | null {
  const explorer = getExplorerUrl(chainId);
  return explorer ? `${explorer}/tx/${hash}` : null;
}
