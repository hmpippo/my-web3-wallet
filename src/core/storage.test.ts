import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_METADATA_STORAGE_KEY,
  BIOMETRIC_VAULT_STORAGE_KEY,
  IMPORTED_ACCOUNT_PATH,
  createStorageService,
  storageService,
  VAULT_STORAGE_KEY,
  WALLET_REGISTRY_STORAGE_KEY,
  walletAccountMetadataKey,
  walletBiometricVaultKey,
  walletVaultKey,
  type WalletAccountMetadata,
  type WalletRegistry,
} from "./storage";
import type { StorageBackend } from "./storage-backend";
import type { EncryptedVault } from "./crypto";
import type { BiometricVault } from "./biometric-vault";

const WALLET_ID = "wallet-test-1";
const MIGRATION_MARKER_KEY = "wallet_storage_migrated_v1";

const testVault: EncryptedVault = {
  version: 1,
  salt: "c2FsdA==",
  iv: "aXY=",
  ciphertext: "Y2lwaGVydGV4dA==",
};
const testBiometricVault: BiometricVault = {
  version: 1,
  credentialId: "Y3JlZGVudGlhbA",
  rpId: "localhost",
  prfSalt: "c2FsdA==",
  kdfSalt: "a2Rmc2FsdA==",
  iv: "aXY=",
  ciphertext: "Y2lwaGVydGV4dA==",
  createdAt: 1_700_000_000_000,
};
const testAccountMetadata: WalletAccountMetadata = {
  version: 1,
  accounts: [
    {
      path: "m/44'/60'/0'/0/0",
      name: "Account 1",
      hidden: false,
      tokens: [],
      nfts: [],
    },
    {
      path: "m/44'/60'/0'/0/2",
      name: "Savings",
      hidden: false,
      tokens: [
        {
          chainId: 11155111,
          address: "0x0000000000000000000000000000000000000001",
          name: "Test Token",
          symbol: "TST",
          decimals: 6,
          hidden: false,
        },
      ],
      nfts: [
        {
          chainId: 11155111,
          address: "0x0000000000000000000000000000000000000003",
          tokenId: "42",
          standard: "ERC-721",
          name: "Test NFT",
          description: "A test item",
          imageUrl: "https://example.com/image.png",
        },
      ],
    },
  ],
  selectedPath: "m/44'/60'/0'/0/2",
};
const testRegistry: WalletRegistry = {
  version: 1,
  wallets: [
    { id: WALLET_ID, name: "Spending", createdAt: 1_700_000_000_000 },
  ],
  selectedId: WALLET_ID,
};

interface MemoryBackend extends StorageBackend {
  readonly records: Map<string, string>;
  readonly writes: ReadonlyArray<readonly [string, string]>;
  failWrites: boolean;
}

function createMemoryBackend(): MemoryBackend {
  const records = new Map<string, string>();
  const writes: Array<readonly [string, string]> = [];

  const backend: MemoryBackend = {
    records,
    writes,
    failWrites: false,
    async get(key) {
      return records.get(key) ?? null;
    },
    async set(key, value) {
      await backend.setMany([[key, value]]);
    },
    async setMany(entries) {
      if (backend.failWrites) throw new Error("wallet storage unavailable");
      for (const [key, value] of entries) {
        records.set(key, value);
        writes.push([key, value]);
      }
    },
    async delete(key) {
      await backend.deleteMany([key]);
    },
    async deleteMany(keys) {
      if (backend.failWrites) throw new Error("wallet storage unavailable");
      for (const key of keys) records.delete(key);
    },
  };
  return backend;
}

/**
 * A `localStorage` stand-in for the one-time import. `length`/`key` are real
 * so the collector can enumerate namespaced keys, which is what production
 * does; the spies are kept for assertions.
 */
function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: vi.fn(
      (index: number): string | null =>
        Array.from(store.keys())[index] ?? null,
    ),
    getItem: vi.fn((key: string): string | null => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string): void => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string): void => {
      store.delete(key);
    }),
  };
}

type LocalStorageMock = ReturnType<typeof createLocalStorageMock>;

/**
 * Builds a service over a fresh in-memory backend. `legacy` is `null` by
 * default so tests exercise storage semantics without the import; migration
 * tests pass a mock.
 */
function setup(legacy: LocalStorageMock | null = null) {
  const backend = createMemoryBackend();
  const service = createStorageService(backend, { legacyStorage: legacy });
  return { backend, service, legacy };
}

describe("vault storage", () => {
  it("saves and loads the encrypted vault under the wallet-scoped key", async () => {
    const { backend, service } = setup();

    await service.saveVault(WALLET_ID, testVault);

    expect(backend.records.get(walletVaultKey(WALLET_ID))).toBe(
      JSON.stringify(testVault),
    );
    await expect(service.loadVault(WALLET_ID)).resolves.toEqual(testVault);
    await expect(service.hasVault(WALLET_ID)).resolves.toBe(true);
  });

  it("keeps wallets isolated by id", async () => {
    const { service } = setup();

    await service.saveVault(WALLET_ID, testVault);

    await expect(service.loadVault("other-wallet")).resolves.toBeNull();
    await expect(service.hasVault("other-wallet")).resolves.toBe(false);
  });

  it("returns null when no vault has been saved", async () => {
    const { service } = setup();

    await expect(service.loadVault(WALLET_ID)).resolves.toBeNull();
    await expect(service.hasVault(WALLET_ID)).resolves.toBe(false);
  });

  it("clears the stored vault, metadata, and biometric record for one wallet", async () => {
    const { backend, service } = setup();

    await service.saveVault(WALLET_ID, testVault);
    await service.saveAccountMetadata(WALLET_ID, testAccountMetadata);
    await service.saveBiometricVault(WALLET_ID, testBiometricVault);
    await service.clearVault(WALLET_ID);

    expect(backend.records.has(walletVaultKey(WALLET_ID))).toBe(false);
    expect(backend.records.has(walletAccountMetadataKey(WALLET_ID))).toBe(
      false,
    );
    expect(backend.records.has(walletBiometricVaultKey(WALLET_ID))).toBe(false);
    await expect(service.loadVault(WALLET_ID)).resolves.toBeNull();
    await expect(service.loadAccountMetadata(WALLET_ID)).resolves.toBeNull();
    await expect(service.loadBiometricVault(WALLET_ID)).resolves.toBeNull();
  });

  it("saves and loads validated public account metadata", async () => {
    const { backend, service } = setup();

    await service.saveAccountMetadata(WALLET_ID, testAccountMetadata);

    expect(backend.records.get(walletAccountMetadataKey(WALLET_ID))).toBe(
      JSON.stringify(testAccountMetadata),
    );
    await expect(service.loadAccountMetadata(WALLET_ID)).resolves.toEqual(
      testAccountMetadata,
    );
  });

  it("returns null when account metadata has not been created yet", async () => {
    const { service } = setup();

    await expect(service.loadAccountMetadata(WALLET_ID)).resolves.toBeNull();
  });

  it("rejects malformed or unsafe account metadata", async () => {
    const { backend, service } = setup();

    backend.records.set(walletAccountMetadataKey(WALLET_ID), "{");
    await expect(service.loadAccountMetadata(WALLET_ID)).rejects.toThrow(
      "not valid JSON",
    );

    backend.records.set(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        ...testAccountMetadata,
        accounts: [
          ...testAccountMetadata.accounts,
          { path: "m/44'/60'/0'/0/2", name: "Duplicate", hidden: false },
        ],
      }),
    );
    await expect(service.loadAccountMetadata(WALLET_ID)).rejects.toThrow(
      "invalid or duplicate accounts",
    );

    backend.records.set(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        ...testAccountMetadata,
        accounts: testAccountMetadata.accounts.map((account) => ({
          ...account,
          hidden: true,
        })),
      }),
    );
    await expect(service.loadAccountMetadata(WALLET_ID)).rejects.toThrow(
      "invalid or duplicate accounts",
    );
  });

  it("stores an imported-key wallet as a single account without a derivation path", async () => {
    const { service } = setup();
    const importedMetadata: WalletAccountMetadata = {
      version: 1,
      accounts: [
        {
          path: IMPORTED_ACCOUNT_PATH,
          name: "Account 1",
          hidden: false,
          tokens: [],
          nfts: [],
        },
      ],
      selectedPath: IMPORTED_ACCOUNT_PATH,
    };

    await service.saveAccountMetadata(WALLET_ID, importedMetadata);

    await expect(service.loadAccountMetadata(WALLET_ID)).resolves.toEqual(
      importedMetadata,
    );
  });

  it("rejects mixing an imported account with HD accounts", async () => {
    const { backend, service } = setup();

    backend.records.set(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        version: 1,
        accounts: [
          { path: "m/44'/60'/0'/0/0", name: "Account 1", hidden: false },
          { path: IMPORTED_ACCOUNT_PATH, name: "Imported", hidden: false },
        ],
        selectedPath: "m/44'/60'/0'/0/0",
      }),
    );

    await expect(service.loadAccountMetadata(WALLET_ID)).rejects.toThrow(
      "invalid or duplicate accounts",
    );
  });

  it("rejects duplicate or invalid token metadata", async () => {
    const { service } = setup();
    const first = testAccountMetadata.accounts[1]!;
    const token = first.tokens![0]!;

    await expect(
      service.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, tokens: [token, token] },
        ],
      }),
    ).rejects.toThrow("duplicate tokens");

    await expect(
      service.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          {
            ...first,
            tokens: [{ ...token, decimals: 256 }],
          },
        ],
      }),
    ).rejects.toThrow("invalid token");
  });

  it("rejects duplicate or invalid NFT metadata", async () => {
    const { service } = setup();
    const first = testAccountMetadata.accounts[1]!;
    const nft = first.nfts![0]!;
    await expect(
      service.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, nfts: [nft, nft] },
        ],
      }),
    ).rejects.toThrow("duplicate NFTs");

    await expect(
      service.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, nfts: [{ ...nft, imageUrl: "http://127.0.0.1/image" }] },
        ],
      }),
    ).rejects.toThrow("invalid NFT");

    await expect(
      service.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, nfts: [{ ...nft, tokenId: "1e4" }] },
        ],
      }),
    ).rejects.toThrow("invalid NFT");
  });

  it("stores inline data: image links for on-chain NFTs", async () => {
    const { service } = setup();
    const first = testAccountMetadata.accounts[1]!;
    const nft = first.nfts![0]!;
    const imageUrl = `data:image/svg+xml;base64,${Buffer.from(
      "<svg></svg>",
    ).toString("base64")}`;

    await service.saveAccountMetadata(WALLET_ID, {
      ...testAccountMetadata,
      accounts: [
        testAccountMetadata.accounts[0]!,
        { ...first, nfts: [{ ...nft, imageUrl }] },
      ],
    });

    await expect(service.loadAccountMetadata(WALLET_ID)).resolves.toMatchObject(
      {
        accounts: [{ nfts: [] }, { nfts: [{ imageUrl }] }],
      },
    );
  });

  it("loads legacy account records without token or NFT lists as empty lists", async () => {
    const { backend, service } = setup();
    backend.records.set(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        version: 1,
        accounts: [
          { path: "m/44'/60'/0'/0/0", name: "Account 1", hidden: false },
        ],
        selectedPath: "m/44'/60'/0'/0/0",
      }),
    );

    await expect(service.loadAccountMetadata(WALLET_ID)).resolves.toMatchObject(
      {
        accounts: [{ tokens: [], nfts: [] }],
      },
    );
  });

  it("keeps the same token and NFT address on different chains", async () => {
    const { service } = setup();
    const first = testAccountMetadata.accounts[1]!;
    const token = first.tokens![0]!;
    const nft = first.nfts![0]!;

    await service.saveAccountMetadata(WALLET_ID, {
      ...testAccountMetadata,
      accounts: [
        testAccountMetadata.accounts[0]!,
        {
          ...first,
          tokens: [token, { ...token, chainId: 1 }],
          nfts: [nft, { ...nft, chainId: 1 }],
        },
      ],
    });

    await expect(service.loadAccountMetadata(WALLET_ID)).resolves.toMatchObject(
      {
        accounts: [
          { tokens: [], nfts: [] },
          {
            tokens: [{ chainId: 11155111 }, { chainId: 1 }],
            nfts: [{ chainId: 11155111 }, { chainId: 1 }],
          },
        ],
      },
    );
  });

  it("defaults legacy assets without a chain to Sepolia", async () => {
    const { backend, service } = setup();
    backend.records.set(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        version: 1,
        accounts: [
          {
            path: "m/44'/60'/0'/0/0",
            name: "Account 1",
            hidden: false,
            tokens: [
              {
                address: "0x0000000000000000000000000000000000000001",
                name: "Test Token",
                symbol: "TST",
                decimals: 6,
                hidden: false,
              },
            ],
            nfts: [],
          },
        ],
        selectedPath: "m/44'/60'/0'/0/0",
      }),
    );

    await expect(service.loadAccountMetadata(WALLET_ID)).resolves.toMatchObject(
      {
        accounts: [{ tokens: [{ chainId: 11155111 }] }],
      },
    );
  });

  it("rejects assets that reference an unsupported chain", async () => {
    const { service } = setup();
    const first = testAccountMetadata.accounts[1]!;
    const token = first.tokens![0]!;

    await expect(
      service.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, tokens: [{ ...token, chainId: 999999 }] },
        ],
      }),
    ).rejects.toThrow("unsupported chain");
  });

  it("surfaces invalid stored JSON and invalid vault shapes", async () => {
    const { backend, service } = setup();

    backend.records.set(walletVaultKey(WALLET_ID), "{");
    await expect(service.loadVault(WALLET_ID)).rejects.toThrow(
      "Stored vault is not valid JSON",
    );

    backend.records.set(
      walletVaultKey(WALLET_ID),
      JSON.stringify({ version: 1 }),
    );
    await expect(service.loadVault(WALLET_ID)).rejects.toThrow(
      "invalid structure",
    );
  });

  it("fails explicitly outside a browser", async () => {
    await expect(storageService.loadVault(WALLET_ID)).rejects.toThrow(
      "only available in a browser",
    );
    await expect(storageService.loadRegistry()).rejects.toThrow(
      "only available in a browser",
    );
  });
});

describe("wallet registry storage", () => {
  it("saves and loads the registry under a single key", async () => {
    const { backend, service } = setup();

    await service.saveRegistry(testRegistry);

    expect(backend.records.get(WALLET_REGISTRY_STORAGE_KEY)).toBe(
      JSON.stringify(testRegistry),
    );
    await expect(service.loadRegistry()).resolves.toEqual(testRegistry);
  });

  it("returns null when there is no registry and no legacy wallet", async () => {
    const { service } = setup();

    await expect(service.loadRegistry()).resolves.toBeNull();
  });

  it("round-trips a wallet's kind", async () => {
    const { service } = setup();
    const registry: WalletRegistry = {
      version: 1,
      wallets: [
        {
          id: WALLET_ID,
          name: "Imported key 1",
          createdAt: 1_700_000_000_000,
          kind: "privateKey",
        },
      ],
      selectedId: WALLET_ID,
    };

    await service.saveRegistry(registry);

    await expect(service.loadRegistry()).resolves.toEqual(registry);
  });

  it("rejects an unknown kind", async () => {
    const { backend, service } = setup();

    backend.records.set(
      WALLET_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        wallets: [
          {
            id: WALLET_ID,
            name: "Wallet 1",
            createdAt: 1,
            kind: "seedless",
          },
        ],
        selectedId: WALLET_ID,
      }),
    );
    await expect(service.loadRegistry()).rejects.toThrow("invalid wallet");
  });

  it("rejects a malformed or duplicate registry", async () => {
    const { backend, service } = setup();

    backend.records.set(WALLET_REGISTRY_STORAGE_KEY, "{");
    await expect(service.loadRegistry()).rejects.toThrow("not valid JSON");

    backend.records.set(
      WALLET_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        wallets: [
          { id: WALLET_ID, name: "A", createdAt: 1 },
          { id: WALLET_ID, name: "B", createdAt: 2 },
        ],
        selectedId: WALLET_ID,
      }),
    );
    await expect(service.loadRegistry()).rejects.toThrow("duplicate wallets");
  });

  it("migrates a legacy single-wallet install into the registry", async () => {
    const legacy = createLocalStorageMock();
    legacy.setItem(VAULT_STORAGE_KEY, JSON.stringify(testVault));
    legacy.setItem(
      ACCOUNT_METADATA_STORAGE_KEY,
      JSON.stringify(testAccountMetadata),
    );
    legacy.setItem(
      BIOMETRIC_VAULT_STORAGE_KEY,
      JSON.stringify(testBiometricVault),
    );
    const { backend, service } = setup(legacy);

    const registry = await service.loadRegistry();

    expect(registry?.wallets).toHaveLength(1);
    expect(registry?.wallets[0]?.name).toBe("Wallet 1");
    const migratedId = registry?.wallets[0]?.id;
    expect(registry?.selectedId).toBe(migratedId);
    if (!migratedId) throw new Error("expected a migrated wallet id");

    // The records now live under wallet-scoped keys...
    await expect(service.loadVault(migratedId)).resolves.toEqual(testVault);
    await expect(service.loadAccountMetadata(migratedId)).resolves.toEqual(
      testAccountMetadata,
    );
    await expect(service.loadBiometricVault(migratedId)).resolves.toEqual(
      testBiometricVault,
    );
    // ...and the bare legacy keys are gone from both stores.
    expect(backend.records.has(VAULT_STORAGE_KEY)).toBe(false);
    expect(backend.records.has(ACCOUNT_METADATA_STORAGE_KEY)).toBe(false);
    expect(backend.records.has(BIOMETRIC_VAULT_STORAGE_KEY)).toBe(false);
    expect(legacy.getItem(VAULT_STORAGE_KEY)).toBeNull();
    expect(legacy.getItem(ACCOUNT_METADATA_STORAGE_KEY)).toBeNull();
    expect(legacy.getItem(BIOMETRIC_VAULT_STORAGE_KEY)).toBeNull();

    // Migration is idempotent: the persisted registry is returned on reload.
    await expect(service.loadRegistry()).resolves.toEqual(registry);
  });

  it("moves an existing multi-wallet localStorage install into the backend", async () => {
    const legacy = createLocalStorageMock();
    const namespacedVault = walletVaultKey(WALLET_ID);
    const namespacedMetadata = walletAccountMetadataKey(WALLET_ID);
    const namespacedBiometric = walletBiometricVaultKey(WALLET_ID);
    legacy.setItem(
      WALLET_REGISTRY_STORAGE_KEY,
      JSON.stringify(testRegistry),
    );
    legacy.setItem(namespacedVault, JSON.stringify(testVault));
    legacy.setItem(namespacedMetadata, JSON.stringify(testAccountMetadata));
    legacy.setItem(
      namespacedBiometric,
      JSON.stringify(testBiometricVault),
    );
    // Unrelated keys must not be touched.
    legacy.setItem("theme", JSON.stringify("dark"));
    const { backend, service } = setup(legacy);

    await expect(service.loadRegistry()).resolves.toEqual(testRegistry);

    expect(backend.records.get(namespacedVault)).toBe(
      JSON.stringify(testVault),
    );
    expect(backend.records.get(namespacedMetadata)).toBe(
      JSON.stringify(testAccountMetadata),
    );
    expect(backend.records.get(namespacedBiometric)).toBe(
      JSON.stringify(testBiometricVault),
    );
    expect(backend.records.get(WALLET_REGISTRY_STORAGE_KEY)).toBe(
      JSON.stringify(testRegistry),
    );
    expect(backend.records.has(MIGRATION_MARKER_KEY)).toBe(true);

    // Wallet records are cleared from localStorage; UI preferences stay.
    expect(legacy.getItem(namespacedVault)).toBeNull();
    expect(legacy.getItem(namespacedMetadata)).toBeNull();
    expect(legacy.getItem(namespacedBiometric)).toBeNull();
    expect(legacy.getItem(WALLET_REGISTRY_STORAGE_KEY)).toBeNull();
    expect(legacy.getItem("theme")).toBe(JSON.stringify("dark"));
  });

  it("keeps migration pending when there is nothing to import yet", async () => {
    const legacy = createLocalStorageMock();
    const backend = createMemoryBackend();

    await createStorageService(backend, { legacyStorage: legacy }).loadRegistry();
    expect(backend.records.has(MIGRATION_MARKER_KEY)).toBe(false);

    // The profile (or a sync) produces legacy data after the first visit.
    legacy.setItem(WALLET_REGISTRY_STORAGE_KEY, JSON.stringify(testRegistry));
    const second = createStorageService(backend, { legacyStorage: legacy });

    await expect(second.loadRegistry()).resolves.toEqual(testRegistry);
    expect(backend.records.has(MIGRATION_MARKER_KEY)).toBe(true);
  });

  it("does not re-import stale localStorage values after migrating", async () => {
    const legacy = createLocalStorageMock();
    legacy.setItem(
      WALLET_REGISTRY_STORAGE_KEY,
      JSON.stringify(testRegistry),
    );
    legacy.setItem(walletVaultKey(WALLET_ID), JSON.stringify(testVault));
    const backend = createMemoryBackend();

    await createStorageService(backend, { legacyStorage: legacy }).loadRegistry();

    // A stale value reappears (old tab, restored profile snapshot, ...).
    legacy.setItem(
      walletVaultKey(WALLET_ID),
      JSON.stringify({ ...testVault, ciphertext: "b3RoZXI=" }),
    );
    const second = createStorageService(backend, { legacyStorage: legacy });

    await expect(second.loadVault(WALLET_ID)).resolves.toEqual(testVault);
  });

  it("leaves localStorage intact when the backend write fails, then retries", async () => {
    const legacy = createLocalStorageMock();
    legacy.setItem(walletVaultKey(WALLET_ID), JSON.stringify(testVault));
    const { backend, service } = setup(legacy);
    backend.failWrites = true;

    await expect(service.loadRegistry()).rejects.toThrow(
      "wallet storage unavailable",
    );
    expect(legacy.getItem(walletVaultKey(WALLET_ID))).toBe(
      JSON.stringify(testVault),
    );

    backend.failWrites = false;
    await expect(service.loadVault(WALLET_ID)).resolves.toEqual(testVault);
    expect(legacy.getItem(walletVaultKey(WALLET_ID))).toBeNull();
  });
});

describe("biometric vault storage", () => {
  it("saves and loads the biometric vault under the wallet-scoped key", async () => {
    const { backend, service } = setup();

    await service.saveBiometricVault(WALLET_ID, testBiometricVault);

    expect(backend.records.get(walletBiometricVaultKey(WALLET_ID))).toBe(
      JSON.stringify(testBiometricVault),
    );
    await expect(service.loadBiometricVault(WALLET_ID)).resolves.toEqual(
      testBiometricVault,
    );
  });

  it("returns null when no biometric vault has been saved", async () => {
    const { service } = setup();

    await expect(service.loadBiometricVault(WALLET_ID)).resolves.toBeNull();
  });

  it("rejects malformed biometric vault records", async () => {
    const { backend, service } = setup();

    backend.records.set(walletBiometricVaultKey(WALLET_ID), "{");
    await expect(service.loadBiometricVault(WALLET_ID)).rejects.toThrow(
      "not valid JSON",
    );

    backend.records.set(
      walletBiometricVaultKey(WALLET_ID),
      JSON.stringify({ version: 1 }),
    );
    await expect(service.loadBiometricVault(WALLET_ID)).rejects.toThrow(
      "invalid structure",
    );
  });

  it("clears only the biometric vault for one wallet", async () => {
    const { backend, service } = setup();

    await service.saveBiometricVault(WALLET_ID, testBiometricVault);
    await service.clearBiometricVault(WALLET_ID);

    expect(backend.records.has(walletBiometricVaultKey(WALLET_ID))).toBe(false);
    await expect(service.loadBiometricVault(WALLET_ID)).resolves.toBeNull();
  });
});
