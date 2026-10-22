import { getAddress, isAddress, zeroAddress, type Address } from "viem";

/**
 * Address book records are public metadata: a label and an EVM address. They
 * contain no key material and are stored unencrypted alongside the wallet's
 * public metadata.
 */

export const ADDRESS_BOOK_MAX_NAME_LENGTH = 32;
export const ADDRESS_BOOK_MAX_CONTACTS = 500;
export const ADDRESS_BOOK_MAX_KNOWN_ACCOUNTS = 2000;

/** A contact the user added explicitly from Settings → Address book. */
export interface AddressBookContact {
  readonly address: Address;
  readonly name: string;
}

/**
 * An account that belongs to one of the wallets on this device. These entries
 * are created automatically and never listed in the address book UI.
 */
export interface KnownWalletAccount {
  readonly walletId: string;
  readonly path: string;
  readonly address: Address;
  readonly name: string;
}

export interface StoredAddressBookContacts {
  readonly version: 1;
  readonly contacts: readonly AddressBookContact[];
}

export interface StoredKnownAccounts {
  readonly version: 1;
  readonly accounts: readonly KnownWalletAccount[];
}

export type AddressIdentitySource = "contact" | "account";

export interface AddressIdentity {
  readonly address: Address;
  readonly name: string;
  readonly source: AddressIdentitySource;
}

/** A user-facing validation failure from the address book UI. */
export class AddressBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressBookError";
  }
}

const ADDRESS_PATTERN = /^(?:0[xX])?[0-9a-fA-F]{40}$/;

/** Trims and validates a contact name. */
export function normalizeContactName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new AddressBookError("Enter a name for this address.");
  }
  if (name.length > ADDRESS_BOOK_MAX_NAME_LENGTH) {
    throw new AddressBookError(
      `Name must be ${ADDRESS_BOOK_MAX_NAME_LENGTH} characters or fewer.`,
    );
  }
  return name;
}

/**
 * Validates a typed address and returns its checksummed form.
 *
 * Checksum validation matters here for the same reason it does on the send
 * form: it catches an address altered in transit or mistyped.
 */
export function normalizeContactAddress(value: string): Address {
  const input = value.trim();
  if (!ADDRESS_PATTERN.test(input)) {
    throw new AddressBookError("Enter a complete Ethereum address.");
  }
  const normalized = /^0x/i.test(input) ? `0x${input.slice(2)}` : `0x${input}`;
  if (!isAddress(normalized, { strict: true })) {
    throw new AddressBookError(
      "That address fails its checksum check, so it may be mistyped or altered.",
    );
  }
  const address = getAddress(normalized);
  if (address === zeroAddress) {
    throw new AddressBookError("The zero address cannot be saved as a contact.");
  }
  return address;
}

/**
 * Adds a contact, rejecting an address that is already in the book. An address
 * that belongs to one of the user's own accounts is allowed: the explicit
 * contact name then takes precedence over the implicit account name.
 */
export function addContact(
  contacts: readonly AddressBookContact[],
  input: { name: string; address: string },
): AddressBookContact[] {
  const name = normalizeContactName(input.name);
  const address = normalizeContactAddress(input.address);
  if (contacts.some((contact) => contact.address === address)) {
    throw new AddressBookError("That address is already in the address book.");
  }
  if (contacts.length >= ADDRESS_BOOK_MAX_CONTACTS) {
    throw new AddressBookError(
      `The address book can hold at most ${ADDRESS_BOOK_MAX_CONTACTS} contacts.`,
    );
  }
  return [...contacts, { address, name }];
}

/** Renames an existing contact. Contact addresses are immutable. */
export function renameContact(
  contacts: readonly AddressBookContact[],
  address: Address,
  name: string,
): AddressBookContact[] {
  const normalizedName = normalizeContactName(name);
  let found = false;
  const next = contacts.map((contact) => {
    if (contact.address !== address) return contact;
    found = true;
    return { ...contact, name: normalizedName };
  });
  if (!found) throw new AddressBookError("That contact no longer exists.");
  return next;
}

export function removeContact(
  contacts: readonly AddressBookContact[],
  address: Address,
): AddressBookContact[] {
  return contacts.filter((contact) => contact.address !== address);
}

/**
 * Resolves an address to the name that should be shown next to it.
 *
 * Explicit contacts always win. When the address belongs to the user's own
 * accounts, the currently selected wallet's label is preferred over a
 * same-address account from another wallet.
 */
export function resolveAddressIdentity(
  address: string,
  options: {
    contacts: readonly AddressBookContact[];
    accounts: readonly KnownWalletAccount[];
    preferredWalletId?: string | null;
  },
): AddressIdentity | null {
  const target = address.toLowerCase();
  const contact = options.contacts.find(
    (candidate) => candidate.address.toLowerCase() === target,
  );
  if (contact) {
    return { address: contact.address, name: contact.name, source: "contact" };
  }

  const matches = options.accounts.filter(
    (candidate) => candidate.address.toLowerCase() === target,
  );
  if (matches.length === 0) return null;
  const preferred = options.preferredWalletId
    ? matches.find(
        (candidate) => candidate.walletId === options.preferredWalletId,
      )
    : undefined;
  const account = preferred ?? matches[0]!;
  return { address: account.address, name: account.name, source: "account" };
}

/** Parses the stored contacts record. Throws on malformed data. */
export function parseStoredContacts(value: unknown): AddressBookContact[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    !("contacts" in value)
  ) {
    throw new Error("Stored address book has an invalid structure");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.contacts)) {
    throw new Error("Stored address book has an unsupported structure");
  }
  const contacts = candidate.contacts.map(parseStoredContact);
  const addresses = new Set(
    contacts.map((contact) => contact.address.toLowerCase()),
  );
  if (addresses.size !== contacts.length) {
    throw new Error("Stored address book contains duplicate contacts");
  }
  if (contacts.length > ADDRESS_BOOK_MAX_CONTACTS) {
    throw new Error("Stored address book contains too many contacts");
  }
  return contacts;
}

function parseStoredContact(value: unknown): AddressBookContact {
  if (
    typeof value !== "object" ||
    value === null ||
    !("address" in value) ||
    !("name" in value)
  ) {
    throw new Error("Stored address book contains an invalid contact");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.address !== "string" ||
    typeof candidate.name !== "string"
  ) {
    throw new Error("Stored address book contains an invalid contact");
  }

  let address: Address;
  try {
    address = normalizeContactAddress(candidate.address);
  } catch {
    throw new Error("Stored address book contains an invalid address");
  }
  let name: string;
  try {
    name = normalizeContactName(candidate.name);
  } catch {
    throw new Error("Stored address book contains an invalid name");
  }
  return { address, name };
}

/** Parses the stored implicit-account record. Throws on malformed data. */
export function parseStoredKnownAccounts(value: unknown): KnownWalletAccount[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    !("accounts" in value)
  ) {
    throw new Error("Stored known accounts have an invalid structure");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.accounts)) {
    throw new Error("Stored known accounts have an unsupported structure");
  }
  const accounts = candidate.accounts.map(parseStoredKnownAccount);
  const identities = new Set(
    accounts.map((account) => `${account.walletId}:${account.path}`),
  );
  if (identities.size !== accounts.length) {
    throw new Error("Stored known accounts contain duplicate entries");
  }
  if (accounts.length > ADDRESS_BOOK_MAX_KNOWN_ACCOUNTS) {
    throw new Error("Stored known accounts contain too many entries");
  }
  return accounts;
}

function parseStoredKnownAccount(value: unknown): KnownWalletAccount {
  if (
    typeof value !== "object" ||
    value === null ||
    !("walletId" in value) ||
    !("path" in value) ||
    !("address" in value) ||
    !("name" in value)
  ) {
    throw new Error("Stored known accounts contain an invalid account");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.walletId !== "string" ||
    candidate.walletId.length === 0 ||
    candidate.walletId.length > 64 ||
    typeof candidate.path !== "string" ||
    candidate.path.length === 0 ||
    candidate.path.length > 128 ||
    typeof candidate.address !== "string" ||
    typeof candidate.name !== "string"
  ) {
    throw new Error("Stored known accounts contain an invalid account");
  }

  let address: Address;
  try {
    address = normalizeContactAddress(candidate.address);
  } catch {
    throw new Error("Stored known accounts contain an invalid address");
  }
  let name: string;
  try {
    name = normalizeContactName(candidate.name);
  } catch {
    throw new Error("Stored known accounts contain an invalid name");
  }
  return {
    walletId: candidate.walletId,
    path: candidate.path,
    address,
    name,
  };
}
