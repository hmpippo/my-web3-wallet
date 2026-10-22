import { describe, expect, it, vi } from "vitest";
import type { StorageBackend } from "@/core/storage-backend";
import {
  ADDRESS_BOOK_ACCOUNTS_STORAGE_KEY,
  ADDRESS_BOOK_CONTACTS_STORAGE_KEY,
  AddressBookService,
  getServerAddressBookState,
} from "./address-book-service";

const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OWN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

interface MemoryBackend extends StorageBackend {
  readonly records: Map<string, string>;
  failReads: boolean;
  failWrites: boolean;
}

function createMemoryBackend(): MemoryBackend {
  const records = new Map<string, string>();
  const backend: MemoryBackend = {
    records,
    failReads: false,
    failWrites: false,
    async get(key) {
      if (backend.failReads) throw new Error("storage unavailable");
      return records.get(key) ?? null;
    },
    async set(key, value) {
      if (backend.failWrites) throw new Error("storage unavailable");
      records.set(key, value);
    },
    async setMany(entries) {
      if (backend.failWrites) throw new Error("storage unavailable");
      for (const [key, value] of entries) records.set(key, value);
    },
    async delete(key) {
      records.delete(key);
    },
    async deleteMany(keys) {
      for (const key of keys) records.delete(key);
    },
  };
  return backend;
}

async function createService(backend = createMemoryBackend()) {
  const service = new AddressBookService(backend);
  await service.init();
  return { backend, service };
}

describe("address book service", () => {
  it("starts empty and exposes an empty server snapshot", async () => {
    const { service } = await createService();

    expect(service.getState().status).toBe("ready");
    expect(service.getState().contacts).toEqual([]);
    expect(service.getState().knownAccounts).toEqual([]);
    expect(getServerAddressBookState().contacts).toEqual([]);
  });

  it("adds, renames, and deletes contacts persistently", async () => {
    const { backend, service } = await createService();
    const listener = vi.fn();
    service.subscribe(listener);

    await service.addContact("Alice", ALICE);
    expect(service.getState().contacts).toEqual([
      { address: ALICE, name: "Alice" },
    ]);
    expect(listener).toHaveBeenCalled();

    await service.renameContact(ALICE, "Alice Smith");
    expect(service.getState().contacts[0]?.name).toBe("Alice Smith");

    const reloaded = new AddressBookService(backend);
    await reloaded.init();
    expect(reloaded.getState().contacts).toEqual([
      { address: ALICE, name: "Alice Smith" },
    ]);

    await service.removeContact(ALICE);
    expect(service.getState().contacts).toEqual([]);
    expect(backend.records.has(ADDRESS_BOOK_CONTACTS_STORAGE_KEY)).toBe(true);
  });

  it("rejects duplicate addresses without changing state", async () => {
    const { service } = await createService();
    await service.addContact("Alice", ALICE);

    await expect(service.addContact("Alice again", ALICE)).rejects.toThrow(
      /already in the address book/,
    );
    expect(service.getState().contacts).toHaveLength(1);
  });

  it("serializes concurrent writes", async () => {
    const { backend, service } = await createService();

    await Promise.all([
      service.addContact("Alice", ALICE),
      service.addContact("Bob", BOB),
    ]);

    expect(service.getState().contacts).toHaveLength(2);
    const stored = JSON.parse(
      backend.records.get(ADDRESS_BOOK_CONTACTS_STORAGE_KEY) ?? "{}",
    ) as { contacts: unknown[] };
    expect(stored.contacts).toHaveLength(2);
  });

  it("records every account of a wallet, replacing its previous entries", async () => {
    const { service } = await createService();

    await service.rememberWalletAccounts("wallet-a", [
      {
        path: "m/44'/60'/0'/0/0",
        address: OWN,
        name: "Account 1",
      },
      {
        path: "m/44'/60'/0'/0/1",
        address: ALICE,
        name: "Hidden savings",
      },
    ]);
    await service.rememberWalletAccounts("wallet-b", [
      {
        path: "imported",
        address: BOB,
        name: "Imported account",
      },
    ]);

    expect(service.getState().knownAccounts).toHaveLength(3);

    await service.rememberWalletAccounts("wallet-a", [
      {
        path: "m/44'/60'/0'/0/0",
        address: OWN,
        name: "Renamed account",
      },
    ]);

    const names = service
      .getState()
      .knownAccounts.map((account) => account.name)
      .sort();
    expect(names).toEqual(["Imported account", "Renamed account"]);
  });

  it("forgets a deleted wallet's implicit entries", async () => {
    const { service } = await createService();
    await service.rememberWalletAccounts("wallet-a", [
      { path: "m/44'/60'/0'/0/0", address: OWN, name: "Account 1" },
    ]);
    await service.rememberWalletAccounts("wallet-b", [
      { path: "imported", address: BOB, name: "Imported account" },
    ]);

    await service.forgetWallet("wallet-a");

    expect(service.getState().knownAccounts).toEqual([
      {
        walletId: "wallet-b",
        path: "imported",
        address: BOB,
        name: "Imported account",
      },
    ]);
  });

  it("restores implicit accounts from storage", async () => {
    const { backend, service } = await createService();
    await service.rememberWalletAccounts("wallet-a", [
      { path: "m/44'/60'/0'/0/0", address: OWN, name: "Account 1" },
    ]);

    const reloaded = new AddressBookService(backend);
    await reloaded.init();
    expect(reloaded.getState().knownAccounts).toEqual([
      {
        walletId: "wallet-a",
        path: "m/44'/60'/0'/0/0",
        address: OWN,
        name: "Account 1",
      },
    ]);
    expect(backend.records.has(ADDRESS_BOOK_ACCOUNTS_STORAGE_KEY)).toBe(true);
  });

  it("reports unavailable storage instead of losing writes silently", async () => {
    const backend = createMemoryBackend();
    backend.failReads = true;
    const service = new AddressBookService(backend);
    await service.init();

    expect(service.getState().status).toBe("error");
    await expect(service.addContact("Alice", ALICE)).rejects.toThrow(
      "storage unavailable",
    );
  });

  it("reports malformed stored data as an error", async () => {
    const backend = createMemoryBackend();
    backend.records.set(ADDRESS_BOOK_CONTACTS_STORAGE_KEY, "{not json");
    const service = new AddressBookService(backend);

    await service.init();

    expect(service.getState().status).toBe("error");
    expect(service.getState().error).toMatch(/not valid JSON/);
  });
});
