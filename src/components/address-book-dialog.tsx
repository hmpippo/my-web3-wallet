"use client";

import {
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
  const state = useSyncExternalStore(
    addressBookService.subscribe,
    addressBookService.getState,
    getServerAddressBookState,
  );
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingAddress, setDeletingAddress] = useState<Address | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocusTarget = returnFocusRef.current;
    document.body.style.overflow = "hidden";
    nameRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTarget?.focus();
    };
  }, [returnFocusRef]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, onClose]);

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      await addressBookService.addContact(name, address);
      setName("");
      setAddress("");
      nameRef.current?.focus();
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
          <div>
            <h2 id="address-book-title">Address book</h2>
            <p>
              Names appear in the send form when a recipient matches a saved
              address.
            </p>
          </div>
          <button
            aria-label="Close address book"
            className="address-book-close"
            disabled={isBusy}
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <form className="address-book-form" onSubmit={addContact}>
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
            <input
              autoComplete="off"
              disabled={!isReady || isBusy}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="0x..."
              required
              spellCheck={false}
              type="text"
              value={address}
            />
          </label>
          <button
            className="button button-primary"
            disabled={!isReady || isBusy}
            type="submit"
          >
            {isBusy ? "Saving..." : "Add contact"}
          </button>
        </form>

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

        <div className="address-book-list-heading">
          <h3>Contacts</h3>
          <span>{contacts.length}</span>
        </div>

        {isReady && contacts.length === 0 ? (
          <p className="address-book-empty">
            No contacts yet. Add one above to label an address in the send
            form.
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

        <p className="field-help">
          Your own wallet accounts are recognized automatically, including
          hidden accounts, but are not listed here.
        </p>
      </section>
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The address book could not be updated.";
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
