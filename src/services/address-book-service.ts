import {
  addContact as addContactToList,
  AddressBookError,
  parseStoredContacts,
  parseStoredKnownAccounts,
  removeContact as removeContactFromList,
  renameContact as renameContactInList,
  type AddressBookContact,
  type KnownWalletAccount,
} from "@/core/address-book";
import {
  createIndexedDbBackend,
  type StorageBackend,
} from "@/core/storage-backend";
import type { Address } from "viem";

export const ADDRESS_BOOK_CONTACTS_STORAGE_KEY =
  "wallet_address_book_contacts_v1";
export const ADDRESS_BOOK_ACCOUNTS_STORAGE_KEY =
  "wallet_known_accounts_v1";

export type AddressBookStatus = "idle" | "loading" | "ready" | "error";

export interface AddressBookState {
  readonly contacts: readonly AddressBookContact[];
  readonly knownAccounts: readonly KnownWalletAccount[];
  readonly status: AddressBookStatus;
  readonly error: string | null;
}

type AddressBookListener = () => void;

/** An account passed in by `WalletService` while a wallet is unlocked. */
export interface AccountToRemember {
  readonly path: string;
  readonly address: Address;
  readonly name: string;
}

const EMPTY_STATE: AddressBookState = Object.freeze({
  contacts: Object.freeze([]),
  knownAccounts: Object.freeze([]),
  status: "idle",
  error: null,
});

function getServerState(): AddressBookState {
  return EMPTY_STATE;
}

/**
 * Device-wide address book.
 *
 * Explicit contacts are managed from Settings. The implicit entries are the
 * accounts of every wallet that has been unlocked on this device; they are
 * never shown in the manager but are used to label recipients that belong to
 * the user. Only public addresses and labels are stored.
 *
 * Like `chainService`, this is a tiny external store read through
 * `useSyncExternalStore`. Writes are serialized so a contact edit and a
 * background account sync can never overwrite each other.
 */
export class AddressBookService {
  private state: AddressBookState = EMPTY_STATE;
  private readonly listeners = new Set<AddressBookListener>();
  private readonly backend: StorageBackend;
  private initPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(backend: StorageBackend = createIndexedDbBackend()) {
    this.backend = backend;
  }

  getState = (): AddressBookState => this.state;

  subscribe = (listener: AddressBookListener): (() => void) => {
    this.listeners.add(listener);
    void this.init().catch(() => undefined);
    return () => this.listeners.delete(listener);
  };

  /** Loads both records once. Safe to call from every entry point. */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.load();
    return this.initPromise;
  }

  async addContact(name: string, address: string): Promise<void> {
    await this.run(async () => {
      const contacts = addContactToList(this.state.contacts, { name, address });
      await this.writeContacts(contacts);
      this.setState({ ...this.state, contacts: freezeContacts(contacts) });
    });
  }

  async renameContact(address: Address, name: string): Promise<void> {
    await this.run(async () => {
      const contacts = renameContactInList(
        this.state.contacts,
        address,
        name,
      );
      await this.writeContacts(contacts);
      this.setState({ ...this.state, contacts: freezeContacts(contacts) });
    });
  }

  async removeContact(address: Address): Promise<void> {
    await this.run(async () => {
      const contacts = removeContactFromList(this.state.contacts, address);
      if (contacts.length === this.state.contacts.length) return;
      await this.writeContacts(contacts);
      this.setState({ ...this.state, contacts: freezeContacts(contacts) });
    });
  }

  /**
   * Records every account of a wallet, replacing that wallet's previous
   * entries. Called on activation and after account changes, so renamed,
   * added, and hidden accounts stay accurate. Failures are the caller's to
   * ignore: the wallet must keep working even when address-book storage is
   * unavailable.
   */
  async rememberWalletAccounts(
    walletId: string,
    accounts: readonly AccountToRemember[],
  ): Promise<void> {
    await this.run(async () => {
      const remembered: KnownWalletAccount[] = accounts.map((account) => ({
        walletId,
        path: account.path,
        address: account.address,
        name: account.name,
      }));
      const others = this.state.knownAccounts.filter(
        (account) => account.walletId !== walletId,
      );
      const next = [...others, ...remembered];
      if (sameAccounts(next, this.state.knownAccounts)) return;
      await this.writeAccounts(next);
      this.setState({
        ...this.state,
        knownAccounts: freezeAccounts(next),
      });
    });
  }

  /** Drops the implicit entries of a wallet that was deleted. */
  async forgetWallet(walletId: string): Promise<void> {
    await this.run(async () => {
      const next = this.state.knownAccounts.filter(
        (account) => account.walletId !== walletId,
      );
      if (next.length === this.state.knownAccounts.length) return;
      await this.writeAccounts(next);
      this.setState({
        ...this.state,
        knownAccounts: freezeAccounts(next),
      });
    });
  }

  private async load(): Promise<void> {
    this.setState({ ...this.state, status: "loading", error: null });
    try {
      const [serializedContacts, serializedAccounts] = await Promise.all([
        this.backend.get(ADDRESS_BOOK_CONTACTS_STORAGE_KEY),
        this.backend.get(ADDRESS_BOOK_ACCOUNTS_STORAGE_KEY),
      ]);
      const contacts =
        serializedContacts === null
          ? []
          : parseStoredContacts(parseJson(serializedContacts, "address book"));
      const accounts =
        serializedAccounts === null
          ? []
          : parseStoredKnownAccounts(
              parseJson(serializedAccounts, "known accounts"),
            );
      this.setState({
        contacts: freezeContacts(contacts),
        knownAccounts: freezeAccounts(accounts),
        status: "ready",
        error: null,
      });
    } catch (error) {
      this.initPromise = null;
      this.setState({
        ...this.state,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "The address book could not be loaded.",
      });
    }
  }

  /** Runs a mutation after initialization, one at a time. */
  private run(task: () => Promise<void>): Promise<void> {
    const execute = async () => {
      await this.init();
      if (this.state.status !== "ready") {
        throw new AddressBookError(
          this.state.error ?? "The address book is unavailable.",
        );
      }
      await task();
    };
    const next = this.queue.then(execute, execute);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async writeContacts(
    contacts: readonly AddressBookContact[],
  ): Promise<void> {
    await this.backend.set(
      ADDRESS_BOOK_CONTACTS_STORAGE_KEY,
      JSON.stringify({ version: 1, contacts }),
    );
  }

  private async writeAccounts(
    accounts: readonly KnownWalletAccount[],
  ): Promise<void> {
    await this.backend.set(
      ADDRESS_BOOK_ACCOUNTS_STORAGE_KEY,
      JSON.stringify({ version: 1, accounts }),
    );
  }

  private setState(next: AddressBookState): void {
    this.state = Object.freeze({ ...next });
    for (const listener of this.listeners) listener();
  }
}

function parseJson(serialized: string, label: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error(`Stored ${label} is not valid JSON`);
  }
}

function freezeContacts(
  contacts: readonly AddressBookContact[],
): readonly AddressBookContact[] {
  return Object.freeze(
    contacts.map((contact) => Object.freeze({ ...contact })),
  );
}

function freezeAccounts(
  accounts: readonly KnownWalletAccount[],
): readonly KnownWalletAccount[] {
  return Object.freeze(
    accounts.map((account) => Object.freeze({ ...account })),
  );
}

function sameAccounts(
  left: readonly KnownWalletAccount[],
  right: readonly KnownWalletAccount[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((account, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      account.walletId === other.walletId &&
      account.path === other.path &&
      account.address === other.address &&
      account.name === other.name
    );
  });
}

export { getServerState as getServerAddressBookState };

export const addressBookService = new AddressBookService();
