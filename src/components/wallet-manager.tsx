"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { walletService } from "@/services/wallet-service";
import { OverflowMenu } from "@/components/overflow-menu";

/**
 * Home-screen wallet manager. Lists every wallet stored on this device, lets the
 * user select one to unlock, rename it, or delete it, and links into the create
 * and import flows. Only public metadata (names) lives here — addresses require
 * unlocking a wallet, so they are intentionally absent.
 */
export function WalletManager() {
  const router = useRouter();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const wallets = walletState.wallets;

  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");

  // Load the registry on mount. It is public metadata, so it can be read while
  // the wallet is locked.
  useEffect(() => {
    void walletService.refreshWallets().catch(() => {
      // A failed read simply leaves the list empty; the user can still set up.
    });
  }, []);

  async function handleUnlock(walletId: string) {
    setError(null);
    setIsBusy(true);
    try {
      await walletService.selectWallet(walletId);
      router.push("/unlock");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not open the wallet.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRename(
    event: FormEvent<HTMLFormElement>,
    walletId: string,
  ) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      await walletService.renameWallet(walletId, draftName);
      setEditingId(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not rename the wallet.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(
    event: FormEvent<HTMLFormElement>,
    walletId: string,
  ) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      await walletService.deleteWallet(walletId, deletePassword);
      setDeletingId(null);
      setDeletePassword("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete the wallet.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <>
      {wallets.length > 0 ? (
        <section className="form-card" aria-labelledby="wallets-title">
          <p className="eyebrow">On this device</p>
          <h1 id="wallets-title">Your wallets</h1>
          <p className="muted-copy">
            Each wallet has its own recovery phrase and password. Select one to
            unlock its accounts.
          </p>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <section
            aria-label="Wallets on this device"
            className="account-management-panel"
          >
            {wallets.map((wallet) => (
              <article className="account-management-row" key={wallet.id}>
                <div className="account-management-identity">
                  <div className="account-management-name">
                    <strong>{wallet.name}</strong>
                    {wallet.id === walletState.selectedWalletId ? (
                      <span className="account-hidden-label">Selected</span>
                    ) : null}
                  </div>
                </div>
                <OverflowMenu
                  label={`${wallet.name} options`}
                  items={[
                    {
                      label: "Unlock",
                      onClick: () => void handleUnlock(wallet.id),
                    },
                    {
                      label: "Rename",
                      onClick: () => {
                        setDraftName(wallet.name);
                        setEditingId(wallet.id);
                      },
                    },
                    {
                      label: "Delete",
                      onClick: () => {
                        setDeletePassword("");
                        setDeletingId(wallet.id);
                      },
                    },
                  ]}
                />

                {editingId === wallet.id ? (
                  <form
                    className="account-rename-form"
                    onSubmit={(event) => void handleRename(event, wallet.id)}
                  >
                    <label htmlFor={`wallet-name-${wallet.id}`}>
                      Wallet name
                    </label>
                    <input
                      autoFocus
                      id={`wallet-name-${wallet.id}`}
                      maxLength={32}
                      onChange={(event) => setDraftName(event.target.value)}
                      required
                      value={draftName}
                    />
                    <div className="account-row-actions">
                      <button
                        className="button button-outline"
                        disabled={isBusy}
                        type="submit"
                      >
                        Save name
                      </button>
                      <button
                        className="text-button"
                        disabled={isBusy}
                        onClick={() => setEditingId(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}

                {deletingId === wallet.id ? (
                  <form
                    className="account-rename-form"
                    onSubmit={(event) => void handleDelete(event, wallet.id)}
                  >
                    <p className="field-help">
                      This permanently removes “{wallet.name}” from this device.
                      Without its recovery phrase, the funds cannot be restored.
                    </p>
                    <label htmlFor={`wallet-delete-${wallet.id}`}>
                      Enter its password to delete
                    </label>
                    <input
                      autoComplete="current-password"
                      id={`wallet-delete-${wallet.id}`}
                      onChange={(event) => setDeletePassword(event.target.value)}
                      required
                      type="password"
                      value={deletePassword}
                    />
                    <div className="account-row-actions">
                      <button
                        className="button button-outline"
                        disabled={isBusy}
                        type="submit"
                      >
                        {isBusy ? "Deleting..." : "Delete wallet"}
                      </button>
                      <button
                        className="text-button"
                        disabled={isBusy}
                        onClick={() => {
                          setDeletingId(null);
                          setDeletePassword("");
                        }}
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

          <div className="form-actions">
            <Link className="button button-primary" href="/create">
              Create wallet
            </Link>
            <Link className="button button-outline" href="/import">
              Import wallet
            </Link>
          </div>
        </section>
      ) : (
        <section className="setup-panel" aria-labelledby="start-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Get started</p>
              <h2 id="start-title">Choose how to begin</h2>
            </div>
            <span className="preview-label">Self-custody</span>
          </div>

          <div className="setup-options">
            <article className="setup-option">
              <span className="option-number">01</span>
              <div>
                <h3>Create a wallet</h3>
                <p>
                  Generate a recovery phrase and protect it with a password.
                </p>
              </div>
              <Link className="button button-primary" href="/create">
                Create wallet
              </Link>
            </article>
            <article className="setup-option">
              <span className="option-number">02</span>
              <div>
                <h3>Import a wallet</h3>
                <p>Restore your wallet from a 12 or 24-word recovery phrase.</p>
              </div>
              <Link className="button button-outline" href="/import">
                Import wallet
              </Link>
            </article>
          </div>
        </section>
      )}

      <aside className="preview-note">
        <span className="status-dot" aria-hidden="true" />
        <p>
          Switch networks from the header. Testnet funds have no real value; on
          mainnets you are moving real assets. Never enter a recovery phrase you
          use for real funds.
        </p>
      </aside>
    </>
  );
}
