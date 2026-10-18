"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Address, Chain, Hash } from "viem";
import { CopyButton } from "@/components/copy-button";
import { getExplorerTxUrl } from "@/core/chain";
import { useActiveChain } from "@/lib/use-active-chain";
import { walletService } from "@/services/wallet-service";

/**
 * EIP-7702 delegation screen for the selected account.
 *
 * The outer component tracks the live wallet session and remounts the panel
 * (via `key`) whenever the account or chain changes, so the panel only ever
 * has to fetch — and reset — the delegation for one account at a time.
 */
export function AccountAbstraction() {
  const { chain, chainId, isTestnet } = useActiveChain();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const address = walletState.address;

  if (!address) {
    return (
      <main className="page-main">
        <p className="muted-copy" role="status">
          Loading your account...
        </p>
      </main>
    );
  }

  return (
    <DelegationPanel
      key={`${address}:${chainId}`}
      address={address}
      chainId={chainId}
      chain={chain}
      isTestnet={isTestnet}
    />
  );
}

interface DelegationPanelProps {
  address: Address;
  chainId: number;
  chain: Chain;
  isTestnet: boolean;
}

/**
 * Reads the delegate the account points to (its code is `0xef0100 || address`
 * while delegated) and lets the user revoke it. Revoking broadcasts a real
 * type-4 transaction, so the account must be unlocked and pays the gas itself.
 */
function DelegationPanel({
  address,
  chainId,
  chain,
  isTestnet,
}: DelegationPanelProps) {
  const [delegation, setDelegation] = useState<Address | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);

  useEffect(() => {
    let cancelled = false;
    walletService
      .getDelegatedAddress(chainId)
      .then((result) => {
        if (!cancelled) setDelegation(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not read the current delegation.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, chainId]);

  async function refreshDelegation() {
    try {
      setDelegation(await walletService.getDelegatedAddress(chainId));
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not read the current delegation.",
      );
    }
  }

  async function handleRevoke() {
    setIsRevoking(true);
    setRevokeError(null);
    try {
      const hash = await walletService.revokeAccountDelegation(chainId);
      setTxHash(hash);
      setIsConfirming(false);
      await refreshDelegation();
    } catch (error) {
      setRevokeError(
        error instanceof Error
          ? error.message
          : "Could not revoke the delegation.",
      );
    } finally {
      setIsRevoking(false);
    }
  }

  const explorerTxUrl = txHash ? getExplorerTxUrl(chainId, txHash) : null;

  return (
    <main className="page-main">
      <section className="page-heading">
        <p className="eyebrow">
          {chain.name} {isTestnet ? "testnet" : "mainnet"}
        </p>
        <h1>Account abstraction</h1>
        <p>
          Account abstraction lets this account run contract code through an
          EIP-7702 delegation while keeping the same address and key. This
          screen shows the delegate the selected account points to, if any.
        </p>
      </section>

      <section
        className="preview-card delegation-card"
        aria-labelledby="delegation-heading"
      >
        <h2 id="delegation-heading">Delegated address</h2>

        {isLoading ? (
          <p className="muted-copy" role="status">
            Reading the current delegation...
          </p>
        ) : loadError ? (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        ) : delegation ? (
          <>
            <p className="muted-copy delegation-intro">
              This account delegates execution to the contract below.
            </p>
            <div className="selected-address delegation-address">
              <code title={delegation}>{delegation}</code>
              <CopyButton label="delegated address" value={delegation} />
            </div>
          </>
        ) : (
          <p className="muted-copy" role="status">
            This account has no active delegation.
          </p>
        )}

        {txHash ? (
          <p className="delegation-success" role="status">
            Delegation revoked.{" "}
            {explorerTxUrl ? (
              <a
                className="text-link"
                href={explorerTxUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                View transaction
              </a>
            ) : (
              <code title={txHash}>{txHash}</code>
            )}
          </p>
        ) : null}

        {revokeError ? (
          <p className="form-error" role="alert">
            {revokeError}
          </p>
        ) : null}

        <div className="delegation-actions">
          {isConfirming ? (
            <>
              <p className="muted-copy delegation-confirm-copy">
                Revoking clears the delegation and returns this account to a
                plain account. It sends a transaction on {chain.name} and costs
                gas.
              </p>
              <div className="delegation-confirm-actions">
                <button
                  className="button button-primary"
                  disabled={isRevoking}
                  onClick={() => void handleRevoke()}
                  type="button"
                >
                  {isRevoking ? "Revoking..." : "Confirm revoke"}
                </button>
                <button
                  className="button button-outline"
                  disabled={isRevoking}
                  onClick={() => setIsConfirming(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button
              className="button button-outline"
              disabled={!delegation || isLoading || isRevoking}
              onClick={() => {
                setTxHash(null);
                setRevokeError(null);
                setIsConfirming(true);
              }}
              type="button"
            >
              Revoke
            </button>
          )}
        </div>
      </section>

      <Link className="text-link back-link" href="/wallet">
        Back to wallet
      </Link>
    </main>
  );
}
