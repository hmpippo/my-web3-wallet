"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { truncateAddress } from "@/lib/address";
import { walletService } from "@/services/wallet-service";
import { CopyButton } from "@/components/copy-button";
import { TransactionHistory } from "@/components/transaction-history";
import { TokenPortfolio } from "@/components/token-portfolio";
import { NftPortfolio } from "@/components/nft-portfolio";

export function WalletDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const address = walletState.address;
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isManagingAccounts, setIsManagingAccounts] = useState(false);
  const [editingAccountIndex, setEditingAccountIndex] = useState<number | null>(
    null,
  );
  const [draftAccountName, setDraftAccountName] = useState("");
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [showReceiveNote, setShowReceiveNote] = useState(false);
  // Allows a deep link such as /wallet?tab=nfts to open on a specific tab.
  const [activePortfolioTab, setActivePortfolioTab] = useState<
    "tokens" | "nfts" | "activity"
  >(() => {
    const requestedTab = searchParams.get("tab");
    return requestedTab === "nfts" || requestedTab === "activity"
      ? requestedTab
      : "tokens";
  });
  const visibleAccounts = walletState.accounts.filter((account) => !account.hidden);
  const selectedAccount = walletState.accounts.find(
    (account) => account.index === walletState.selectedAccountIndex,
  );

  // Opening the NFT list (or switching account) re-checks ownership on chain so
  // a token transferred away in the meantime disappears from the account.
  useEffect(() => {
    if (activePortfolioTab !== "nfts" || !address) return;
    void walletService.syncNftOwnership();
  }, [activePortfolioTab, address]);

  async function handleAddAccount() {
    try {
      setAccountError(null);
      await walletService.addAccount();
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Could not add an account.",
      );
    }
  }

  async function handleAccountChange(index: number) {
    try {
      setAccountError(null);
      await walletService.selectAccount(index);
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Could not switch accounts.",
      );
    }
  }

  async function handleRenameAccount(
    event: FormEvent<HTMLFormElement>,
    index: number,
  ) {
    event.preventDefault();
    setIsSavingAccount(true);
    try {
      setAccountError(null);
      await walletService.renameAccount(index, draftAccountName);
      setEditingAccountIndex(null);
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Could not rename the account.",
      );
    } finally {
      setIsSavingAccount(false);
    }
  }

  async function handleSetAccountVisibility(index: number, hidden: boolean) {
    try {
      setAccountError(null);
      if (hidden) {
        await walletService.restoreAccount(index);
      } else {
        await walletService.hideAccount(index);
      }
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Could not update the account.",
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

      <section className="preview-card balance-card" aria-labelledby="account-heading">
        <div className="balance-topline">
          <h2 id="account-heading">Account</h2>
          <span className="network-label">
            <span className="status-dot" aria-hidden="true" />
            Sepolia testnet
          </span>
        </div>
        <div className="account-controls">
          <label htmlFor="wallet-account">Accounts in this wallet</label>
          <select
            id="wallet-account"
            aria-label="Select account"
            onChange={(event) => void handleAccountChange(Number(event.target.value))}
            value={walletState.selectedAccountIndex ?? 0}
          >
            {visibleAccounts.map((account) => (
              <option key={account.index} value={account.index}>
                {account.name} · {account.address}
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
        <div className="account-management">
          <button
            aria-controls="wallet-account-management"
            aria-expanded={isManagingAccounts}
            className="text-link"
            onClick={() => setIsManagingAccounts((open) => !open)}
            type="button"
          >
            {isManagingAccounts ? "Close account management" : "Manage accounts"}
          </button>
          {isManagingAccounts ? (
            <section
              aria-label="Accounts in this wallet"
              className="account-management-panel"
              id="wallet-account-management"
            >
              {walletState.accounts.map((account) => (
                <article className="account-management-row" key={account.path}>
                  <div className="account-management-identity">
                    <div className="account-management-name">
                      <strong>{account.name}</strong>
                      {account.hidden ? (
                        <span className="account-hidden-label">Hidden</span>
                      ) : null}
                    </div>
                    <div className="address-line">
                      <code>{account.address}</code>
                      <CopyButton
                        label={`${account.name} address`}
                        value={account.address}
                      />
                    </div>
                    <span className="account-derivation-path">{account.path}</span>
                  </div>
                  {editingAccountIndex === account.index ? (
                    <form
                      className="account-rename-form"
                      onSubmit={(event) =>
                        void handleRenameAccount(event, account.index)
                      }
                    >
                      <label htmlFor={`account-name-${account.index}`}>
                        Account name
                      </label>
                      <input
                        autoFocus
                        id={`account-name-${account.index}`}
                        maxLength={32}
                        onChange={(event) =>
                          setDraftAccountName(event.target.value)
                        }
                        required
                        value={draftAccountName}
                      />
                      <div className="account-row-actions">
                        <button
                          className="button button-outline"
                          disabled={isSavingAccount}
                          type="submit"
                        >
                          Save name
                        </button>
                        <button
                          className="text-button"
                          disabled={isSavingAccount}
                          onClick={() => setEditingAccountIndex(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="account-row-actions">
                      <button
                        className="button button-outline"
                        onClick={() => {
                          setDraftAccountName(account.name);
                          setEditingAccountIndex(account.index);
                        }}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        aria-label={`${account.hidden ? "Show" : "Hide"} ${account.name}`}
                        className="text-button"
                        onClick={() =>
                          void handleSetAccountVisibility(
                            account.index,
                            account.hidden,
                          )
                        }
                        type="button"
                      >
                        {account.hidden ? "Show" : "Hide"}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </section>
          ) : null}
        </div>
        {accountError ? (
          <p className="form-error" role="alert">
            {accountError}
          </p>
        ) : null}
        {address ? (
          <div className="selected-address">
            <code title={address}>{truncateAddress(address)}</code>
            <CopyButton label="your address" value={address} />
          </div>
        ) : null}
        <div className="dashboard-actions">
          <Link className="button button-primary" href="/send">
            Send
          </Link>
          <button
            aria-expanded={showReceiveNote}
            className="button button-outline"
            onClick={() => setShowReceiveNote((open) => !open)}
            type="button"
          >
            Receive
          </button>
        </div>
        {showReceiveNote ? (
          <p className="receive-note" role="status">
            Receive is coming soon.
          </p>
        ) : null}
      </section>
      <div className="portfolio-tabs" role="tablist" aria-label="Wallet overview">
        <button
          aria-controls="portfolio-tokens"
          aria-selected={activePortfolioTab === "tokens"}
          className="portfolio-tab"
          id="portfolio-tokens-tab"
          onClick={() => setActivePortfolioTab("tokens")}
          role="tab"
          type="button"
        >
          Tokens
        </button>
        <button
          aria-controls="portfolio-nfts"
          aria-selected={activePortfolioTab === "nfts"}
          className="portfolio-tab"
          id="portfolio-nfts-tab"
          onClick={() => setActivePortfolioTab("nfts")}
          role="tab"
          type="button"
        >
          NFTs
        </button>
        <button
          aria-controls="portfolio-activity"
          aria-selected={activePortfolioTab === "activity"}
          className="portfolio-tab"
          id="portfolio-activity-tab"
          onClick={() => setActivePortfolioTab("activity")}
          role="tab"
          type="button"
        >
          Activity
        </button>
      </div>
      {activePortfolioTab === "tokens" && address && selectedAccount ? (
        <div
          aria-labelledby="portfolio-tokens-tab"
          id="portfolio-tokens"
          role="tabpanel"
        >
          <TokenPortfolio
            accountAddress={address}
            key={selectedAccount.path}
            tokens={selectedAccount.tokens}
          />
        </div>
      ) : null}
      {activePortfolioTab === "nfts" && address && selectedAccount ? (
        <div
          aria-labelledby="portfolio-nfts-tab"
          id="portfolio-nfts"
          role="tabpanel"
        >
          <NftPortfolio
            key={selectedAccount.path}
            nfts={selectedAccount.nfts}
          />
        </div>
      ) : null}
      {activePortfolioTab === "activity" && address ? (
        <div
          aria-labelledby="portfolio-activity-tab"
          id="portfolio-activity"
          role="tabpanel"
        >
          <TransactionHistory key={address} address={address} />
        </div>
      ) : null}
    </main>
  );
}
