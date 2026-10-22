import { describe, expect, it } from "vitest";
import {
  addContact,
  AddressBookError,
  normalizeContactAddress,
  normalizeContactName,
  parseStoredContacts,
  parseStoredKnownAccounts,
  removeContact,
  renameContact,
  resolveAddressIdentity,
  type AddressBookContact,
  type KnownWalletAccount,
} from "./address-book";

const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OWN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ZERO = "0x0000000000000000000000000000000000000000";

const contacts: readonly AddressBookContact[] = [
  { address: ALICE, name: "Alice" },
];

const accounts: readonly KnownWalletAccount[] = [
  {
    walletId: "wallet-a",
    path: "m/44'/60'/0'/0/0",
    address: OWN,
    name: "Main account",
  },
  {
    walletId: "wallet-b",
    path: "m/44'/60'/0'/0/0",
    address: OWN,
    name: "Other wallet account",
  },
];

describe("address book validation", () => {
  it("normalizes a lowercase or bare address to checksum form", () => {
    expect(normalizeContactAddress(ALICE.toLowerCase())).toBe(ALICE);
    expect(normalizeContactAddress(ALICE.slice(2))).toBe(ALICE);
    expect(normalizeContactAddress(`  ${ALICE}  `)).toBe(ALICE);
  });

  it("rejects incomplete, badly checksummed, and zero addresses", () => {
    expect(() => normalizeContactAddress("0x1234")).toThrow(AddressBookError);
    expect(() =>
      normalizeContactAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79C8"),
    ).toThrow(/checksum/);
    expect(() => normalizeContactAddress(ZERO)).toThrow(/zero address/);
  });

  it("trims names and enforces the length limit", () => {
    expect(normalizeContactName("  Alice  ")).toBe("Alice");
    expect(() => normalizeContactName("   ")).toThrow(/name/i);
    expect(() => normalizeContactName("x".repeat(33))).toThrow(/32/);
  });

  it("adds a contact and rejects a duplicate address", () => {
    const next = addContact([], { name: "Alice", address: ALICE });
    expect(next).toEqual([{ address: ALICE, name: "Alice" }]);
    expect(() =>
      addContact(next, { name: "Someone else", address: ALICE.toLowerCase() }),
    ).toThrow(/already in the address book/);
  });

  it("renames and removes contacts by address", () => {
    const renamed = renameContact(contacts, ALICE, "Alice Smith");
    expect(renamed).toEqual([{ address: ALICE, name: "Alice Smith" }]);
    expect(() => renameContact(contacts, BOB, "Bob")).toThrow(
      /no longer exists/,
    );
    expect(removeContact(renamed, ALICE)).toEqual([]);
  });
});

describe("address identity resolution", () => {
  it("prefers an explicit contact over an implicit account", () => {
    expect(
      resolveAddressIdentity(OWN, {
        contacts: [{ address: OWN, name: "Treasury" }],
        accounts,
        preferredWalletId: "wallet-b",
      }),
    ).toEqual({ address: OWN, name: "Treasury", source: "contact" });
  });

  it("prefers the selected wallet's label for a shared address", () => {
    expect(
      resolveAddressIdentity(OWN, {
        contacts: [],
        accounts,
        preferredWalletId: "wallet-b",
      }),
    ).toEqual({
      address: OWN,
      name: "Other wallet account",
      source: "account",
    });
  });

  it("falls back to the first matching account and returns null when unknown", () => {
    expect(
      resolveAddressIdentity(OWN.toLowerCase(), {
        contacts: [],
        accounts,
      }),
    ).toMatchObject({ name: "Main account", source: "account" });
    expect(
      resolveAddressIdentity(BOB, { contacts, accounts }),
    ).toBeNull();
  });
});

describe("stored address book records", () => {
  it("parses a valid contacts record", () => {
    expect(
      parseStoredContacts({ version: 1, contacts }),
    ).toEqual(contacts);
  });

  it("rejects duplicate or malformed contacts", () => {
    expect(() =>
      parseStoredContacts({
        version: 1,
        contacts: [contacts[0], contacts[0]],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      parseStoredContacts({
        version: 1,
        contacts: [{ address: "0x1234", name: "Alice" }],
      }),
    ).toThrow(/invalid address/);
    expect(() =>
      parseStoredContacts({ version: 1, contacts: [{ address: ALICE, name: "" }] }),
    ).toThrow(/invalid name/);
  });

  it("parses known accounts and rejects duplicate wallet paths", () => {
    expect(
      parseStoredKnownAccounts({ version: 1, accounts }),
    ).toEqual(accounts);
    expect(() =>
      parseStoredKnownAccounts({
        version: 1,
        accounts: [accounts[0], accounts[0]],
      }),
    ).toThrow(/duplicate/);
  });
});
