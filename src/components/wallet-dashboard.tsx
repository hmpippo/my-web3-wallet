"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatEther, type Address } from "viem";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getNativeBalance } from "@/services/balance-service";
import { walletService } from "@/services/wallet-service";
import { TransactionHistory } from "@/components/transaction-history";

export function WalletDashboard() {
  const router = useRouter();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const address = walletState.address;
  const [balanceResult, setBalanceResult] = useState<{
    address: Address;
    value: string;
  } | null>(null);
  const [balanceError, setBalanceError] = useState<{
    address: Address;
    message: string;
  } | null>(null);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const balance =
    address && balanceResult?.address === address ? balanceResult.value : null;
  const currentBalanceError =
    address && balanceError?.address === address ? balanceError.message : null;
  const isLoadingBalance =
    Boolean(address) &&
    (isRefreshingBalance || (balance === null && currentBalanceError === null));

  const refreshBalance = useCallback(() => {
    if (!address) return;
    setIsRefreshingBalance(true);
    setBalanceError(null);
    getNativeBalance(address)
      .then((result) => setBalanceResult({ address, value: formatEther(result) }))
      .catch((error: unknown) => {
        setBalanceError({
          address,
          message:
            error instanceof Error
              ? error.message
              : "Could not load the Sepolia balance.",
        });
      })
      .finally(() => setIsRefreshingBalance(false));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getNativeBalance(address)
      .then((result) => {
        if (!cancelled) setBalanceResult({ address, value: formatEther(result) });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBalanceError({
            address,
            message:
              error instanceof Error
                ? error.message
                : "Could not load the Sepolia balance.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIsRefreshingBalance(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  function handleAddAccount() {
    try {
      setAccountError(null);
      walletService.addAccount();
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Could not add an account.",
      );
    }
  }

  function handleAccountChange(index: number) {
    try {
      setAccountError(null);
      walletService.selectAccount(index);
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Could not switch accounts.",
      );
    }
  }

  function lockWallet() {
    walletService.lock();
    router.replace("/");
  }

  return (
    <main className="page-main">
      <section className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">Sepolia wallet</p>
          <h1>Your wallet</h1>
        </div>
        <button className="button button-outline" onClick={lockWallet} type="button">
          Lock wallet
        </button>
      </section>

      <section className="preview-card balance-card" aria-labelledby="balance-heading">
        <div className="balance-topline">
          <h2 id="balance-heading">Available balance</h2>
          <span className="network-label">
            <span className="status-dot" aria-hidden="true" />
            Sepolia testnet
          </span>
        </div>
        <div className="account-controls">
          <label htmlFor="wallet-account">Account</label>
          <select
            id="wallet-account"
            aria-label="Select account"
            onChange={(event) => handleAccountChange(Number(event.target.value))}
            value={walletState.selectedAccountIndex ?? 0}
          >
            {walletState.accounts.map((account) => (
              <option key={account.index} value={account.index}>
                Account {account.index + 1} · {account.address}
              </option>
            ))}
          </select>
          <button
            className="button button-outline account-add"
            onClick={handleAddAccount}
            type="button"
          >
            Add account
          </button>
        </div>
        {accountError ? (
          <p className="form-error" role="alert">
            {accountError}
          </p>
        ) : null}
        {isLoadingBalance ? (
          <p className="balance-placeholder" role="status">
            Loading...
          </p>
        ) : currentBalanceError ? (
          <div className="balance-error" role="alert">
            <p>{currentBalanceError}</p>
            <button className="text-link" onClick={refreshBalance} type="button">
              Try again
            </button>
          </div>
        ) : (
          <p className="balance-value">
            {balance} <span>ETH</span>
          </p>
        )}
        <div className="address-panel">
          <span>Your address</span>
          <code>{address}</code>
        </div>
        <div className="dashboard-actions">
          <Link className="button button-primary" href="/send">
            Send ETH
          </Link>
        </div>
      </section>
      {address ? <TransactionHistory key={address} address={address} /> : null}
    </main>
  );
}
