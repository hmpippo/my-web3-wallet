"use client";

import { useSyncExternalStore } from "react";
import type { Chain } from "viem";
import { getWalletChain } from "@/core/chain";
import { chainService, getServerChainState } from "@/services/chain-service";

export interface ActiveChain {
  readonly chainId: number;
  readonly chain: Chain;
  readonly isTestnet: boolean;
}

/** Subscribes to the selected chain and returns its viem definition. */
export function useActiveChain(): ActiveChain {
  const { activeChainId } = useSyncExternalStore(
    chainService.subscribe,
    chainService.getState,
    getServerChainState,
  );
  const walletChain = getWalletChain(activeChainId);
  return {
    chainId: walletChain.chain.id,
    chain: walletChain.chain,
    isTestnet: walletChain.isTestnet,
  };
}
