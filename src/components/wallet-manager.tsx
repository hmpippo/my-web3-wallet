"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import type { StoredWalletSummary } from "@/core/storage";
import { walletService } from "@/services/wallet-service";
import { OverflowMenu } from "@/components/overflow-menu";
import { MainAction, MainActions } from "@/components/action-tile";
import { PasswordInput } from "@/components/password-input";

/**
 * Home-screen wallet manager. Recovery-phrase wallets and single-account
 * private-key wallets are shown as two separate groups, since they are set up
 * and backed up differently. Each row can be selected for unlock, renamed, or
 * deleted. Only public metadata (names and kinds) lives here — plain addresses
 * are not persisted, so they stay absent until a wallet is unlocked.
 */
export function WalletManager() {
  const router = useRouter();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const wallets = walletState.wallets;
  // Legacy entries written before private-key import had no `kind`; they are
  // always recovery-phrase wallets.
  const phraseWallets = wallets.filter(
    (wallet) => wallet.kind !== "privateKey",
  );
  const importedWallets = wallets.filter(
    (wallet) => wallet.kind === "privateKey",
  );

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

  /**
   * One wallet row, shared by both groups. Rendered through a helper rather than
   * a component so it can close over the manager's rename/delete state.
   */
  function renderWalletRow(wallet: StoredWalletSummary): ReactNode {
    const isImported = wallet.kind === "privateKey";
    return (
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
              icon: "unlock",
              onClick: () => void handleUnlock(wallet.id),
            },
            {
              label: "Rename",
              icon: "rename",
              onClick: () => {
                setDraftName(wallet.name);
                setEditingId(wallet.id);
              },
            },
            {
              label: "Delete",
              icon: "delete",
              tone: "danger",
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
              {isImported ? "Account name" : "Wallet name"}
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
              {isImported
                ? " Without its private key, the funds cannot be restored."
                : " Without its recovery phrase, the funds cannot be restored."}
            </p>
            <label htmlFor={`wallet-delete-${wallet.id}`}>
              Enter its password to delete
            </label>
            <PasswordInput
              autoComplete="current-password"
              id={`wallet-delete-${wallet.id}`}
              onChange={(event) => setDeletePassword(event.target.value)}
              required
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
    );
  }

  return (
    <>
      <MainActions>
        <MainAction href="/create" icon="create" label="Create wallet" />
        <MainAction href="/import" icon="import" label="Import wallet" />
        <MainAction
          href="/import/private-key"
          icon="key"
          label="Import private key"
        />
      </MainActions>

      {error ? (
        <p className="form-error home-error" role="alert">
          {error}
        </p>
      ) : null}

      {phraseWallets.length > 0 || importedWallets.length > 0 ? (
        <div className="wallet-manager-groups">
          {phraseWallets.length > 0 ? (
            <section className="form-card" aria-labelledby="wallets-title">
              <p className="eyebrow">On this device</p>
              <h1 id="wallets-title">Your wallets</h1>
              <p className="muted-copy">
                Each wallet has its own recovery phrase and password. Select one
                to unlock its accounts.
              </p>

              <section
                aria-label="Wallets on this device"
                className="account-management-panel"
              >
                {phraseWallets.map((wallet) => renderWalletRow(wallet))}
              </section>
            </section>
          ) : null}

          {importedWallets.length > 0 ? (
            <section className="form-card" aria-labelledby="imported-title">
              <p className="eyebrow">On this device</p>
              <h2 id="imported-title">Imported accounts</h2>
              <p className="muted-copy">
                Private keys imported as their own single-account wallets.
                Select one to unlock it.
              </p>

              <section
                aria-label="Imported accounts on this device"
                className="account-management-panel"
              >
                {importedWallets.map((wallet) => renderWalletRow(wallet))}
              </section>
            </section>
          ) : null}
        </div>
      ) : null}

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
