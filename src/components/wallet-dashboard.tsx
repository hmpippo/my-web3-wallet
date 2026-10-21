"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useActiveChain } from "@/lib/use-active-chain";
import {
  selectAccountNfts,
  selectAccountTokens,
  walletService,
} from "@/services/wallet-service";
import { AccountSwitcher } from "@/components/account-switcher";
import { BiometricToggle } from "@/components/biometric-toggle";
import { MainAction, MainActions } from "@/components/action-tile";
import { CopyButton } from "@/components/copy-button";
import { TransactionHistory } from "@/components/transaction-history";
import { TokenPortfolio } from "@/components/token-portfolio";
import { NftPortfolio } from "@/components/nft-portfolio";
import { LockIcon } from "@/components/wallet-icons";

export function WalletDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { chainId, chain, isTestnet } = useActiveChain();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const address = walletState.address;
  const [accountError, setAccountError] = useState<string | null>(null);
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
  const selectedWallet = walletState.wallets.find(
    (wallet) => wallet.id === walletState.selectedWalletId,
  );
  const selectedAccount = walletState.accounts.find(
    (account) => account.index === walletState.selectedAccountIndex,
  );
  const chainTokens = useMemo(
    () => (selectedAccount ? selectAccountTokens(selectedAccount, chainId) : []),
    [selectedAccount, chainId],
  );
  const chainNfts = useMemo(
    () => (selectedAccount ? selectAccountNfts(selectedAccount, chainId) : []),
    [selectedAccount, chainId],
  );

  // Opening the NFT list (or switching account/chain) re-checks ownership on
  // chain so a token transferred away in the meantime disappears.
  useEffect(() => {
    if (activePortfolioTab !== "nfts" || !address) return;
    void walletService.syncNftOwnership(chainId);
  }, [activePortfolioTab, address, chainId]);

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

  function lockWallet() {
    walletService.lock();
    router.replace("/");
  }

  return (
    <main className="page-main">
      <section className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">
            {selectedWallet ? selectedWallet.name : "Your wallet"} · {chain.name}
          </p>
          <h1>Your wallet</h1>
        </div>
        <div className="dashboard-heading-actions">
          <BiometricToggle
            key={walletState.selectedWalletId ?? "no-wallet"}
          />
          <button
            className="button button-outline lock-wallet-button"
            onClick={lockWallet}
            type="button"
          >
            <LockIcon />
            Lock wallet
          </button>
        </div>
      </section>

      {isTestnet ? null : (
        <p className="mainnet-warning" role="status">
          <span className="status-dot" aria-hidden="true" />
          You are on {chain.name} mainnet. Balances and transfers use real funds.
        </p>
      )}

      <section className="preview-card balance-card" aria-labelledby="account-heading">
        <div className="balance-topline">
          <h2 id="account-heading">Account</h2>
          <span className="network-label">
            <span className="status-dot" aria-hidden="true" />
            {chain.name} {isTestnet ? "testnet" : "mainnet"}
          </span>
        </div>
        <div className="account-picker-block">
          <div className="account-picker-heading">
            <span className="account-picker-label">
              Accounts in this wallet
            </span>
            <Link className="text-link account-manage-link" href="/accounts">
              Manage accounts
            </Link>
          </div>
          {address ? (
            <div className="account-picker-row">
              <AccountSwitcher
                accounts={visibleAccounts}
                onSelect={(index) => void handleAccountChange(index)}
                selectedIndex={walletState.selectedAccountIndex}
              />
              <CopyButton
                className="account-picker-copy"
                label="account address"
                value={address}
              />
            </div>
          ) : null}
        </div>
        {accountError ? (
          <p className="form-error" role="alert">
            {accountError}
          </p>
        ) : null}
        <MainActions ariaLabel="Account actions" className="dashboard-actions">
          <MainAction href="/send" icon="send" label="Send" />
          <MainAction href="/receive" icon="receive" label="Receive" />
          <MainAction
            href="/account-abstraction"
            icon="abstract"
            label="Account Abstract"
          />
        </MainActions>
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
            chainId={chainId}
            key={`${selectedAccount.path}:${chainId}`}
            tokens={chainTokens}
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
            chainId={chainId}
            key={`${selectedAccount.path}:${chainId}`}
            nfts={chainNfts}
          />
        </div>
      ) : null}
      {activePortfolioTab === "activity" && address ? (
        <div
          aria-labelledby="portfolio-activity-tab"
          id="portfolio-activity"
          role="tabpanel"
        >
          <TransactionHistory
            address={address}
            chainId={chainId}
            key={`${address}:${chainId}`}
          />
        </div>
      ) : null}
    </main>
  );
}
