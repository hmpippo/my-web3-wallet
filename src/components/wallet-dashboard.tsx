"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatEther } from "viem";
import { useCallback, useEffect, useState } from "react";
import { getNativeBalance } from "@/services/balance-service";
import { walletService } from "@/services/wallet-service";
import { TransactionHistory } from "@/components/transaction-history";

export function WalletDashboard() {
  const router = useRouter();
  const address = walletService.getAddress();
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);

  const refreshBalance = useCallback(() => {
    if (!address) return;
    setIsLoadingBalance(true);
    setBalanceError(null);
    getNativeBalance(address)
      .then((result) => setBalance(formatEther(result)))
      .catch((error: unknown) => {
        setBalanceError(
          error instanceof Error
            ? error.message
            : "Could not load the Sepolia balance.",
        );
      })
      .finally(() => setIsLoadingBalance(false));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getNativeBalance(address)
      .then((result) => {
        if (!cancelled) setBalance(formatEther(result));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBalanceError(
            error instanceof Error
              ? error.message
              : "Could not load the Sepolia balance.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBalance(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

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
        {isLoadingBalance ? (
          <p className="balance-placeholder" role="status">
            Loading...
          </p>
        ) : balanceError ? (
          <div className="balance-error" role="alert">
            <p>{balanceError}</p>
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
