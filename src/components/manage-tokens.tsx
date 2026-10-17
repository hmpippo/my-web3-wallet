"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { useActiveChain } from "@/lib/use-active-chain";
import {
  selectAccountTokens,
  walletService,
} from "@/services/wallet-service";
import { CopyButton } from "@/components/copy-button";
import { ToggleSwitch } from "@/components/toggle-switch";

/**
 * Full token list for the selected account and chain with a visibility switch
 * per token. The native asset is always visible, so its switch is on and
 * disabled.
 */
export function ManageTokens() {
  const { chainId, chain } = useActiveChain();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const selectedAccount = walletState.accounts.find(
    (account) => account.index === walletState.selectedAccountIndex,
  );
  const tokens = selectedAccount
    ? selectAccountTokens(selectedAccount, chainId)
    : [];
  const native = chain.nativeCurrency;
  const [error, setError] = useState<string | null>(null);
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);

  async function setVisibility(address: Address, hidden: boolean) {
    setError(null);
    setPendingAddress(address.toLowerCase());
    try {
      if (hidden) {
        await walletService.hideToken(address, chainId);
      } else {
        await walletService.restoreToken(address, chainId);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update the token visibility.",
      );
    } finally {
      setPendingAddress(null);
    }
  }

  return (
    <main className="page-main">
      <section className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">{chain.name} assets</p>
          <h1>Manage tokens</h1>
        </div>
        <Link className="button button-outline" href="/wallet">
          Back to wallet
        </Link>
      </section>

      <section className="history-card token-card" aria-labelledby="manage-tokens-heading">
        <div className="history-heading">
          <div>
            <p className="eyebrow">Visibility</p>
            <h2 id="manage-tokens-heading">Tokens for this account</h2>
          </div>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <ul className="token-list" aria-label="Token visibility">
          <li className="token-item token-item-manage token-item-native">
            <div className="token-identity">
              <strong>{native.name}</strong>
              <span>{native.symbol}</span>
              <span className="token-badge">Native asset</span>
            </div>
            <div className="token-actions">
              <ToggleSwitch
                checked
                disabled
                label={`${native.symbol} is always visible`}
                onChange={() => {}}
              />
            </div>
          </li>
          {tokens.map((token) => (
            <li
              className="token-item token-item-manage"
              key={token.address}
            >
              <div className="token-identity">
                <strong>{token.name}</strong>
                <span>{token.symbol}</span>
                <div className="address-line">
                  <code>{token.address}</code>
                  <CopyButton
                    label={`${token.symbol} contract address`}
                    value={token.address}
                  />
                </div>
              </div>
              <div className="token-actions">
                <ToggleSwitch
                  checked={!token.hidden}
                  disabled={pendingAddress === token.address.toLowerCase()}
                  label={`${token.hidden ? "Show" : "Hide"} ${token.name}`}
                  onChange={(next) => void setVisibility(token.address, !next)}
                />
              </div>
            </li>
          ))}
        </ul>
        {tokens.length === 0 ? (
          <p className="muted-copy token-empty">
            No ERC-20 tokens yet. Import one to track its balance.
          </p>
        ) : null}

        <div className="card-footer-action">
          <Link className="button button-primary" href="/tokens/import">
            <span aria-hidden="true" className="button-plus">
              +
            </span>
            Import token
          </Link>
        </div>
      </section>
    </main>
  );
}
