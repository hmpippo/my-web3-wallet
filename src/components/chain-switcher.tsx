"use client";

import { SUPPORTED_CHAINS } from "@/core/chain";
import { useActiveChain } from "@/lib/use-active-chain";
import { chainService } from "@/services/chain-service";

const MAINNETS = SUPPORTED_CHAINS.filter((chain) => !chain.isTestnet);
const TESTNETS = SUPPORTED_CHAINS.filter((chain) => chain.isTestnet);

/** Global network picker. Testnets and mainnets are grouped for clarity. */
export function ChainSwitcher() {
  const { chainId, chain, isTestnet } = useActiveChain();

  return (
    <label className="chain-switcher">
      <span className="chain-switcher-label">Network</span>
      <span className="chain-switcher-control">
        <span
          aria-hidden="true"
          className={`status-dot${isTestnet ? "" : " status-dot-mainnet"}`}
        />
        <select
          aria-label="Select network"
          className="chain-switcher-select"
          onChange={(event) =>
            chainService.setActiveChain(Number(event.target.value))
          }
          value={chainId}
        >
          <optgroup label="Mainnets">
            {MAINNETS.map((option) => (
              <option key={option.chain.id} value={option.chain.id}>
                {option.chain.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Testnets">
            {TESTNETS.map((option) => (
              <option key={option.chain.id} value={option.chain.id}>
                {option.chain.name}
              </option>
            ))}
          </optgroup>
        </select>
      </span>
      <span className="sr-only" role="status">
        {isTestnet
          ? `${chain.name} testnet selected`
          : `${chain.name} mainnet selected`}
      </span>
    </label>
  );
}
