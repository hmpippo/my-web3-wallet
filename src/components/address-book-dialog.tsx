"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type RefObject,
} from "react";
import type { Address } from "viem";
import {
  ADDRESS_BOOK_MAX_NAME_LENGTH,
  type AddressBookContact,
} from "@/core/address-book";
import { truncateAddress } from "@/lib/address";
import { parseRecipientInput, RecipientInputError } from "@/lib/recipient-input";
import { useActiveChain } from "@/lib/use-active-chain";
import { QrScannerDialog } from "@/components/qr-scanner-dialog";
import {
  addressBookService,
  getServerAddressBookState,
} from "@/services/address-book-service";

interface AddressBookDialogProps {
  onClose: () => void;
  /** Focused again when the dialog closes, so keyboard users stay in place. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Settings dialog for explicit contacts.
 *
 * Implicit entries (the user's own wallet accounts) are deliberately absent:
 * they are recognized when sending but are not editable here. Closing the
 * dialog never touches the wallet or its keys.
 */
export function AddressBookDialog({
  onClose,
  returnFocusRef,
}: AddressBookDialogProps) {
  const { chainId } = useActiveChain();
  const state = useSyncExternalStore(
    addressBookService.subscribe,
    addressBookService.getState,
    getServerAddressBookState,
  );
  const [view, setView] = useState<"list" | "add">("list");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingAddress, setDeletingAddress] = useState<Address | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const isReady = state.status === "ready";
  const contacts = useMemo(
    () =>
      [...state.contacts].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
        }),
      ),
    [state.contacts],
  );

  const backToContacts = useCallback(() => {
    setView("list");
    setError(null);
    setName("");
    setAddress("");
    setScannerOpen(false);
    setScanError(null);
    window.requestAnimationFrame(() => addButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocusTarget = returnFocusRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTarget?.focus();
    };
  }, [returnFocusRef]);

  useEffect(() => {
    if (view === "add") nameRef.current?.focus();
  }, [view]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || isBusy || scannerOpen) return;
      event.preventDefault();
      if (view === "add") {
        backToContacts();
      } else {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [backToContacts, isBusy, onClose, scannerOpen, view]);

  function openAddContact() {
    setError(null);
    setName("");
    setAddress("");
    setScanError(null);
    setEditingAddress(null);
    setEditName("");
    setDeletingAddress(null);
    setView("add");
  }

  function handleScan(raw: string) {
    try {
      const parsed = parseRecipientInput(raw, { chainId });
      setAddress(parsed.address);
      setError(null);
      setScanError(null);
      setScannerOpen(false);
    } catch (caught) {
      setScanError(
        caught instanceof RecipientInputError
          ? caught.message
          : "That QR code doesn't contain a wallet address.",
      );
    }
  }

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      await addressBookService.addContact(name, address);
      setName("");
      setAddress("");
      setView("list");
      window.requestAnimationFrame(() => addButtonRef.current?.focus());
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveRename(contact: AddressBookContact) {
    setError(null);
    setIsBusy(true);
    try {
      await addressBookService.renameContact(contact.address, editName);
      setEditingAddress(null);
      setEditName("");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteContact(contact: AddressBookContact) {
    setError(null);
    setIsBusy(true);
    try {
      await addressBookService.removeContact(contact.address);
      setDeletingAddress(null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div
      className="address-book-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <section
        aria-labelledby="address-book-title"
        aria-modal="true"
        className="address-book-dialog"
        role="dialog"
      >
        <div className="address-book-heading">
          <div className="address-book-heading-copy">
            {view === "add" ? (
              <button
                className="address-book-back"
                disabled={isBusy}
                onClick={backToContacts}
                type="button"
              >
                <BackIcon />
                Back
              </button>
            ) : null}
            <h2 id="address-book-title">
              {view === "add" ? "Add contact" : "Address book"}
            </h2>
          </div>
          <button
            aria-label="Close address book"
            className="address-book-close"
            disabled={isBusy}
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {state.status === "loading" || state.status === "idle" ? (
          <p className="field-help" role="status">
            Loading contacts...
          </p>
        ) : null}
        {state.status === "error" ? (
          <p className="form-error" role="alert">
            {state.error ?? "The address book is unavailable."}
          </p>
        ) : null}

        {view === "add" ? (
          <form
            className="address-book-form address-book-add-form"
            onSubmit={addContact}
          >
            <label>
              Name
              <input
                autoComplete="off"
                disabled={!isReady || isBusy}
                maxLength={ADDRESS_BOOK_MAX_NAME_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder="Alice"
                ref={nameRef}
                required
                type="text"
                value={name}
              />
            </label>
            <label>
              Wallet address
              <span className="address-book-address-field">
                <input
                  autoComplete="off"
                  disabled={!isReady || isBusy}
                  onChange={(event) => {
                    setAddress(event.target.value);
                    setScanError(null);
                  }}
                  placeholder="0x..."
                  required
                  spellCheck={false}
                  type="text"
                  value={address}
                />
                <button
                  aria-label="Scan wallet address QR code"
                  className="recipient-scan-button"
                  disabled={!isReady || isBusy}
                  onClick={() => {
                    setScanError(null);
                    setScannerOpen(true);
                  }}
                  title="Scan wallet address QR code"
                  type="button"
                >
                  <ScanIcon />
                  <span className="recipient-scan-label">Scan</span>
                </button>
              </span>
            </label>
            <button
              className="button button-primary"
              disabled={!isReady || isBusy}
              type="submit"
            >
              {isBusy ? "Saving..." : "Add contact"}
            </button>
          </form>
        ) : (
          <>
            <div className="address-book-list-heading">
              <h3>Contacts</h3>
              <span>{contacts.length}</span>
            </div>

            {isReady && contacts.length === 0 ? (
              <p className="address-book-empty">
                No contacts yet. Use Add contact below to label an address in
                the send form.
              </p>
            ) : null}

            <ul className="address-book-list">
              {contacts.map((contact) => {
                const isEditing = editingAddress === contact.address;
                const isDeleting = deletingAddress === contact.address;
                return (
                  <li className="address-book-item" key={contact.address}>
                    {isEditing ? (
                      <form
                        className="address-book-edit"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveRename(contact);
                        }}
                      >
                        <input
                          aria-label={`Name for ${truncateAddress(contact.address)}`}
                          autoFocus
                          disabled={isBusy}
                          maxLength={ADDRESS_BOOK_MAX_NAME_LENGTH}
                          onChange={(event) => setEditName(event.target.value)}
                          required
                          type="text"
                          value={editName}
                        />
                        <div className="address-book-item-actions">
                          <button
                            className="button button-primary button-compact"
                            disabled={isBusy}
                            type="submit"
                          >
                            Save
                          </button>
                          <button
                            className="button button-outline button-compact"
                            disabled={isBusy}
                            onClick={() => {
                              setEditingAddress(null);
                              setEditName("");
                            }}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <span className="address-book-identity">
                          <strong className="account-picker-name">
                            {contact.name}
                          </strong>
                          <code
                            className="account-picker-address"
                            title={contact.address}
                          >
                            {truncateAddress(contact.address)}
                          </code>
                        </span>
                        <div className="address-book-item-actions">
                          {isDeleting ? (
                            <>
                              <span className="address-book-confirm">
                                Delete?
                              </span>
                              <button
                                className="button button-danger button-compact"
                                disabled={isBusy}
                                onClick={() => void deleteContact(contact)}
                                type="button"
                              >
                                Delete
                              </button>
                              <button
                                className="button button-outline button-compact"
                                disabled={isBusy}
                                onClick={() => setDeletingAddress(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="button button-outline button-compact"
                                disabled={isBusy}
                                onClick={() => {
                                  setEditingAddress(contact.address);
                                  setEditName(contact.name);
                                  setDeletingAddress(null);
                                  setError(null);
                                }}
                                type="button"
                              >
                                Edit
                              </button>
                              <button
                                className="button button-outline button-compact"
                                disabled={isBusy}
                                onClick={() => {
                                  setDeletingAddress(contact.address);
                                  setEditingAddress(null);
                                  setError(null);
                                }}
                                type="button"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="address-book-footer">
              <button
                className="button button-primary address-book-add"
                disabled={!isReady || isBusy}
                onClick={openAddContact}
                ref={addButtonRef}
                type="button"
              >
                <PlusIcon />
                Add contact
              </button>
            </div>
          </>
        )}
      </section>
      {scannerOpen ? (
        <QrScannerDialog
          errorMessage={scanError}
          onClose={() => {
            setScannerOpen(false);
            setScanError(null);
          }}
          onScan={handleScan}
          title="Scan wallet address QR code"
        />
      ) : null}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The address book could not be updated.";
}

function BackIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 16 16"
    >
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 16 16"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function ScanIcon() {
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
      <path d="M2 5.5V4a2 2 0 0 1 2-2h1.5M10.5 2H12a2 2 0 0 1 2 2v1.5M14 10.5V12a2 2 0 0 1-2 2h-1.5M5.5 14H4a2 2 0 0 1-2-2v-1.5" />
      <path d="M2 8h12" />
    </svg>
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
      strokeWidth="1.8"
      viewBox="0 0 16 16"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
