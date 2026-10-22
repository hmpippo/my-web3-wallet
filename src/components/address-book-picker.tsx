"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { Address } from "viem";
import type { KnownWalletAccount } from "@/core/address-book";
import { IMPORTED_ACCOUNT_PATH } from "@/core/storage";
import { truncateAddress } from "@/lib/address";
import {
  addressBookService,
  getServerAddressBookState,
} from "@/services/address-book-service";
import { walletService } from "@/services/wallet-service";

interface AddressBookPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (address: Address) => void;
  /** Focused again after the picker closes. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Read-only address list used wherever the user needs to choose a recipient.
 *
 * Entries are grouped into wallets, imported accounts, and contacts. Selecting
 * a row only hands the address to the caller; it never mutates the address
 * book.
 */
export function AddressBookPicker({
  open,
  onClose,
  onSelect,
  returnFocusRef,
}: AddressBookPickerProps) {
  const state = useSyncExternalStore(
    addressBookService.subscribe,
    addressBookService.getState,
    getServerAddressBookState,
  );
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const walletsHeadingId = useId();
  const importedHeadingId = useId();
  const contactsHeadingId = useId();

  const contacts = useMemo(
    () =>
      [...state.contacts].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
        }),
      ),
    [state.contacts],
  );

  const addressGroups = useMemo(() => {
    const accountsByWallet = new Map<string, KnownWalletAccount[]>();
    for (const account of state.knownAccounts) {
      const accounts = accountsByWallet.get(account.walletId);
      if (accounts) {
        accounts.push(account);
      } else {
        accountsByWallet.set(account.walletId, [account]);
      }
    }

    const groups: Array<{
      walletId: string;
      name: string;
      imported: boolean;
      accounts: KnownWalletAccount[];
    }> = [];

    for (const wallet of walletState.wallets) {
      const accounts = accountsByWallet.get(wallet.id);
      if (!accounts) continue;
      groups.push({
        walletId: wallet.id,
        name: wallet.name,
        imported: wallet.kind === "privateKey",
        accounts: sortPickerAccounts(accounts),
      });
      accountsByWallet.delete(wallet.id);
    }

    for (const [walletId, accounts] of accountsByWallet) {
      groups.push({
        walletId,
        name: "Wallet",
        imported: accounts.every(
          (account) => account.path === IMPORTED_ACCOUNT_PATH,
        ),
        accounts: sortPickerAccounts(accounts),
      });
    }

    return {
      wallets: groups.filter((group) => !group.imported),
      imported: groups.filter((group) => group.imported),
    };
  }, [state.knownAccounts, walletState.wallets]);

  const hasEntries =
    addressGroups.wallets.length > 0 ||
    addressGroups.imported.length > 0 ||
    contacts.length > 0;

  useEffect(() => {
    if (!open) return;

    const trigger = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="address-picker-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="address-picker-panel"
        role="dialog"
      >
        <div className="address-picker-header">
          <h2 id={titleId}>Choose from address book</h2>
          <button
            aria-label="Close address picker"
            className="address-book-close"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="address-picker-body">
          {addressGroups.wallets.length > 0 ? (
            <section
              aria-labelledby={walletsHeadingId}
              className="address-picker-group"
            >
              <h3 id={walletsHeadingId}>Wallets</h3>
              {addressGroups.wallets.map((group) => (
                <div className="address-picker-subgroup" key={group.walletId}>
                  <h4>{group.name}</h4>
                  <ul className="address-picker-list">
                    {group.accounts.map((account) => (
                      <li key={`${group.walletId}:${account.path}`}>
                        <PickerRow
                          address={account.address}
                          name={account.name}
                          onSelect={onSelect}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ) : null}

          {addressGroups.imported.length > 0 ? (
            <section
              aria-labelledby={importedHeadingId}
              className="address-picker-group"
            >
              <h3 id={importedHeadingId}>Imported accounts</h3>
              {addressGroups.imported.map((group) => (
                <div className="address-picker-subgroup" key={group.walletId}>
                  <h4>{group.name}</h4>
                  <ul className="address-picker-list">
                    {group.accounts.map((account) => (
                      <li key={`${group.walletId}:${account.path}`}>
                        <PickerRow
                          address={account.address}
                          name={account.name}
                          onSelect={onSelect}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ) : null}

          {contacts.length > 0 ? (
            <section
              aria-labelledby={contactsHeadingId}
              className="address-picker-group"
            >
              <h3 id={contactsHeadingId}>Contacts</h3>
              <ul className="address-picker-list">
                {contacts.map((contact) => (
                  <li key={contact.address}>
                    <PickerRow
                      address={contact.address}
                      name={contact.name}
                      onSelect={onSelect}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!hasEntries ? (
            <p className="address-book-empty">No saved addresses yet.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PickerRow({
  address,
  name,
  onSelect,
}: {
  address: Address;
  name: string;
  onSelect: (address: Address) => void;
}) {
  return (
    <button
      className="address-picker-row"
      onClick={() => onSelect(address)}
      type="button"
    >
      <span className="address-picker-row-copy">
        <strong>{name}</strong>
        <code title={address}>{truncateAddress(address)}</code>
      </span>
    </button>
  );
}

function sortPickerAccounts(
  accounts: readonly KnownWalletAccount[],
): KnownWalletAccount[] {
  return [...accounts].sort(
    (left, right) =>
      left.path.localeCompare(right.path, undefined, { numeric: true }) ||
      left.name.localeCompare(right.name),
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
