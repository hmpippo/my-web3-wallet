"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useActiveChain } from "@/lib/use-active-chain";
import { walletService } from "@/services/wallet-service";
import { IMPORTED_ACCOUNT_PATH } from "@/core/storage";
import { CopyButton } from "@/components/copy-button";
import { OverflowMenu } from "@/components/overflow-menu";

/**
 * Wallet account management on its own page: rename, hide/show, and a per
 * account overflow menu. Adding an account lives here too.
 */
export function ManageAccounts() {
  const { chain } = useActiveChain();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const accounts = walletState.accounts;
  const isImportedWallet = accounts.some(
    (account) => account.path === IMPORTED_ACCOUNT_PATH,
  );
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleAddAccount() {
    setError(null);
    setIsAdding(true);
    try {
      await walletService.addAccount();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not add an account.",
      );
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRename(
    event: FormEvent<HTMLFormElement>,
    index: number,
  ) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await walletService.renameAccount(index, draftName);
      setEditingIndex(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not rename the account.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSetVisibility(index: number, hidden: boolean) {
    setError(null);
    try {
      if (hidden) {
        await walletService.restoreAccount(index);
      } else {
        await walletService.hideAccount(index);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update the account.",
      );
    }
  }

  return (
    <main className="page-main">
      <section className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">{chain.name} wallet</p>
          <h1>Manage accounts</h1>
        </div>
        <Link className="button button-outline" href="/wallet">
          Back to wallet
        </Link>
      </section>

      <section className="history-card" aria-labelledby="manage-accounts-heading">
        <div className="history-heading">
          <div>
            <p className="eyebrow">
              {isImportedWallet ? "Imported key" : "HD accounts"}
            </p>
            <h2 id="manage-accounts-heading">Accounts in this wallet</h2>
          </div>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <section
          aria-label="Accounts in this wallet"
          className="account-management-panel"
        >
          {accounts.map((account) => (
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
                <span className="account-derivation-path">
                  {account.path === IMPORTED_ACCOUNT_PATH
                    ? "Imported private key"
                    : account.path}
                </span>
              </div>
              <OverflowMenu
                label={`${account.name} options`}
                items={[
                  {
                    label: "Rename",
                    icon: "rename",
                    onClick: () => {
                      setDraftName(account.name);
                      setEditingIndex(account.index);
                    },
                  },
                  {
                    label: account.hidden ? "Show" : "Hide",
                    icon: account.hidden ? "show" : "hide",
                    onClick: () =>
                      void handleSetVisibility(account.index, account.hidden),
                  },
                  {
                    label: "Detail",
                    icon: "detail",
                    href: `/accounts/${account.index}`,
                  },
                ]}
              />
              {editingIndex === account.index ? (
                <form
                  className="account-rename-form"
                  onSubmit={(event) =>
                    void handleRename(event, account.index)
                  }
                >
                  <label htmlFor={`account-name-${account.index}`}>
                    Account name
                  </label>
                  <input
                    autoFocus
                    id={`account-name-${account.index}`}
                    maxLength={32}
                    onChange={(event) => setDraftName(event.target.value)}
                    required
                    value={draftName}
                  />
                  <div className="account-row-actions">
                    <button
                      className="button button-outline"
                      disabled={isSaving}
                      type="submit"
                    >
                      Save name
                    </button>
                    <button
                      className="text-button"
                      disabled={isSaving}
                      onClick={() => setEditingIndex(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </article>
          ))}
        </section>

        <div className="card-footer-action">
          {isImportedWallet ? (
            <p className="field-help">
              This wallet was created from a single private key, so it cannot
              derive additional accounts.
            </p>
          ) : (
            <button
              className="button button-primary"
              disabled={isAdding}
              onClick={() => void handleAddAccount()}
              type="button"
            >
              <span aria-hidden="true" className="button-plus">
                +
              </span>
              {isAdding ? "Adding..." : "Add account"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
