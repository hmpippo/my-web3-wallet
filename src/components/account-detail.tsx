"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { CopyButton } from "@/components/copy-button";
import { IMPORTED_ACCOUNT_PATH } from "@/core/storage";
import { useActiveChain } from "@/lib/use-active-chain";
import { walletService } from "@/services/wallet-service";

/**
 * Account detail screen reached from the manage-accounts overflow menu.
 *
 * The account is resolved from the live wallet session by index, so a stale or
 * hand-typed URL falls back to a clear "not found" message rather than showing
 * another account's data. Actions are listed as full-width rows; only the
 * private-key row exists for now, but the layout is built to grow.
 *
 * The index is read on the client with `useParams` so the page itself stays
 * prerenderable; the dynamic segment is only meaningful once the wallet
 * session exists anyway.
 */
export function AccountDetail() {
  const params = useParams<{ index: string }>();
  const index = Number(params?.index);
  const { chain } = useActiveChain();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const account = Number.isInteger(index)
    ? walletState.accounts.find((candidate) => candidate.index === index)
    : undefined;

  if (!account) {
    return (
      <main className="page-main">
        <section className="page-heading">
          <p className="eyebrow">{chain.name} wallet</p>
          <h1>Account not found</h1>
          <p>This account is not part of the current wallet session.</p>
        </section>
        <Link className="text-link back-link" href="/accounts">
          Back to manage accounts
        </Link>
      </main>
    );
  }

  return (
    <main className="page-main">
      <section
        className="account-detail-heading"
        aria-labelledby="account-detail-title"
      >
        <p className="eyebrow">{chain.name} wallet</p>
        <h1 id="account-detail-title">{account.name}</h1>
        <div className="account-detail-address">
          <code title={account.address}>{account.address}</code>
          <CopyButton
            label={`${account.name} address`}
            value={account.address}
          />
        </div>
        <span className="account-derivation-path">
          {account.path === IMPORTED_ACCOUNT_PATH
            ? "Imported private key"
            : account.path}
        </span>
      </section>

      <section
        aria-label="Account settings"
        className="account-detail-rows"
      >
        <Link
          className="account-detail-row"
          href={`/accounts/${account.index}/private-key`}
        >
          <span className="account-detail-row-text">
            <strong>Private keys</strong>
            <span>
              Unlock to reveal, back up, or export this account&apos;s private
              key.
            </span>
          </span>
          <svg
            aria-hidden="true"
            className="account-detail-row-chevron"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
            viewBox="0 0 16 16"
          >
            <path d="M6 3.5l4.5 4.5L6 12.5" />
          </svg>
        </Link>
      </section>

      <Link className="text-link back-link" href="/accounts">
        Back to manage accounts
      </Link>
    </main>
  );
}
